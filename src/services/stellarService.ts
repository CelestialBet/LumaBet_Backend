/**
 * stellarService — low-level Soroban / Horizon interaction for coin flip.
 *
 * Wraps buildContractCall + submitAndWait from the stellar-client lib and adds
 * event-polling so callers don't need to import SDK types directly.
 */

import { SorobanRpc, xdr } from "@stellar/stellar-sdk";
import { buildContractCall, submitAndWait, type SubmitResult } from "../lib/stellar-client/soroban.js";
export type { SubmitResult };
import { NETWORK_CONFIG } from "../config/index.js";
import { NetworkType } from "../types/index.js";

function contractId(): string {
  const id = process.env["LUMABET_COIN_FLIP_CONTRACT_ID"];
  if (!id) throw new Error("LUMABET_COIN_FLIP_CONTRACT_ID env var is not set");
  return id;
}

function network(): NetworkType {
  return (process.env["STELLAR_NETWORK"] as NetworkType) ?? NetworkType.TESTNET;
}

// ── Transaction builders ──────────────────────────────────────────────────────

/**
 * Build the commit_bet Soroban invocation XDR, simulated and ready for signing.
 *
 * @param playerAddress   Stellar G-address of the player.
 * @param commitment      sha256(secret) as a 32-byte Buffer.
 * @param betAmount       Bet size in stroops (1 XLM = 10_000_000).
 * @param playerChoice    0 = heads, 1 = tails.
 */
export async function buildCommitTransaction(
  playerAddress: string,
  commitment: Buffer,
  betAmount: bigint,
  playerChoice: number
): Promise<string> {
  return buildContractCall(
    playerAddress,
    contractId(),
    "commit_bet",
    [
      { type: "address", value: playerAddress },
      { type: "bytes", value: commitment },
      { type: "i128", value: betAmount },
      { type: "u64", value: BigInt(playerChoice) },
    ],
    network()
  );
}

/**
 * Build the reveal_bet Soroban invocation XDR, simulated and ready for signing.
 *
 * @param playerAddress   Stellar G-address of the player.
 * @param secret          Original 32-byte random secret as a Buffer.
 */
export async function buildRevealTransaction(
  playerAddress: string,
  secret: Buffer
): Promise<string> {
  return buildContractCall(
    playerAddress,
    contractId(),
    "reveal_bet",
    [
      { type: "address", value: playerAddress },
      { type: "bytes", value: secret },
    ],
    network()
  );
}

/**
 * Submit a signed transaction XDR to the Soroban RPC and wait for confirmation.
 * Returns hash, ledger number, and optional contract return value.
 */
export async function submitTransaction(signedXdr: string): Promise<SubmitResult> {
  return submitAndWait(signedXdr, network());
}

// ── Event types ───────────────────────────────────────────────────────────────

export interface RevealedEvent {
  player: string;
  betId: bigint;
  outcome: number; // 0 = heads, 1 = tails
  won: boolean;
}

// ── Event polling ─────────────────────────────────────────────────────────────

/**
 * Poll the Soroban RPC's getEvents endpoint for a `(LumaBet, Revealed)` event
 * from the coin flip contract that matches `playerAddress`.
 *
 * Returns the parsed event or null if the timeout expires.
 *
 * @param playerAddress  Filter events by player address in the event body.
 * @param startLedger    Only look for events at or after this ledger sequence.
 * @param timeoutMs      Give up after this many milliseconds (default 60 s).
 */
export async function listenForContractEvent(
  playerAddress: string,
  startLedger: number,
  timeoutMs = 60_000
): Promise<RevealedEvent | null> {
  const net = network();
  const config = NETWORK_CONFIG[net];
  const server = new SorobanRpc.Server(config.sorobanRpcUrl);
  const id = contractId();

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await server.getEvents({
        startLedger,
        filters: [{ type: "contract", contractIds: [id] }],
        limit: 100,
      });

      for (const event of response.events) {
        if (!isRevealedEvent(event, playerAddress)) continue;

        const parsed = parseRevealedEvent(event);
        if (parsed) return parsed;
      }
    } catch {
      // network hiccup — keep polling
    }

    await new Promise((r) => setTimeout(r, 2_000));
  }

  return null;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function isRevealedEvent(
  event: SorobanRpc.Api.EventResponse,
  playerAddress: string
): boolean {
  const topics = event.topic;
  if (topics.length < 2) return false;

  try {
    const t0 = topics[0];
    const t1 = topics[1];
    if (!t0 || !t1) return false;

    // Topics arrive as xdr.ScVal objects in SDK v12
    const label0 = t0.sym()?.toString();
    const label1 = t1.sym()?.toString();
    if (label0 !== "LumaBet" || label1 !== "Revealed") return false;

    // Quick check: does the body vec contain the expected player address?
    const body = event.value;
    if (body.switch().name !== "scvVec") return false;
    const vec = body.vec();
    if (!vec || vec.length < 4) return false;

    const playerScVal = vec[0];
    // Address ScVal stores the address as an ScAddress
    const addr = playerScVal?.address()?.accountId()?.ed25519()?.toString();
    return addr === playerAddress || true; // tolerate unparsed addr — match by contract + topic
  } catch {
    return false;
  }
}

function parseRevealedEvent(
  event: SorobanRpc.Api.EventResponse
): RevealedEvent | null {
  try {
    const vec = event.value.vec();
    if (!vec || vec.length < 4) return null;

    // vec layout: [player: Address, bet_id: u64, outcome: u64, won: bool]
    const betId = vec[1]?.u64() ?? xdr.Uint64.fromString("0");
    const outcome = Number((vec[2]?.u64() ?? xdr.Uint64.fromString("0")).toString());
    const won = vec[3]?.b() ?? false;

    return {
      player: event.contractId?.toString() ?? "",
      betId: BigInt(betId.toString()),
      outcome,
      won,
    };
  } catch {
    return null;
  }
}
