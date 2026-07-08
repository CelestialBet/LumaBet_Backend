/**
 * diceStellarService — low-level Soroban interaction for the dice game.
 *
 * Unlike coin flip (a single contract with commit/reveal), dice spans two
 * contracts and therefore three player-signed transactions:
 *   1. lumabet_core.place_bet     → escrows the stake, returns bet_id
 *   2. lumabet_dice.roll_dice     → draws the outcome via lumabet_rng
 *   3. lumabet_dice.claim_winnings | resolve_lost_bet → finalises in core
 *
 * Each step requires the player's signature (`require_auth`), so the backend
 * never holds a key capable of moving funds — it only builds, submits, and
 * parses.
 */

import { buildContractCall, submitAndWait, type SubmitResult } from "../lib/stellar-client/soroban.js";
export type { SubmitResult };
import { NetworkType } from "../types/index.js";

function coreContractId(): string {
  const id = process.env["LUMABET_CORE_CONTRACT_ID"];
  if (!id) throw new Error("LUMABET_CORE_CONTRACT_ID env var is not set");
  return id;
}

function diceContractId(): string {
  const id = process.env["LUMABET_DICE_CONTRACT_ID"];
  if (!id) throw new Error("LUMABET_DICE_CONTRACT_ID env var is not set");
  return id;
}

function network(): NetworkType {
  return (process.env["STELLAR_NETWORK"] as NetworkType) ?? NetworkType.TESTNET;
}

// ── Transaction builders ──────────────────────────────────────────────────────

/**
 * Build the core.place_bet XDR that escrows the stake and registers the bet.
 * Returns the on-chain bet_id once submitted.
 */
export async function buildPlaceBetTransaction(
  playerAddress: string,
  amountStroops: bigint,
  prediction: number
): Promise<string> {
  return buildContractCall(
    playerAddress,
    coreContractId(),
    "place_bet",
    [
      { type: "address", value: playerAddress },
      { type: "i128", value: amountStroops },
      { type: "symbol", value: "DICE" },
      { type: "u64", value: BigInt(prediction) },
    ],
    network()
  );
}

/**
 * Build the dice.roll_dice XDR. `seed` should be a fresh random u64 supplied
 * by the caller — it is mixed into lumabet_rng along with ledger state.
 */
export async function buildRollDiceTransaction(
  playerAddress: string,
  betId: bigint,
  prediction: number,
  seed: bigint
): Promise<string> {
  return buildContractCall(
    playerAddress,
    diceContractId(),
    "roll_dice",
    [
      { type: "address", value: playerAddress },
      { type: "u64", value: betId },
      { type: "u64", value: BigInt(prediction) },
      { type: "u64", value: seed },
    ],
    network()
  );
}

/** Build the dice.claim_winnings XDR — finalises a won bet in lumabet_core. */
export async function buildClaimWinningsTransaction(
  playerAddress: string,
  betId: bigint
): Promise<string> {
  return buildContractCall(
    playerAddress,
    diceContractId(),
    "claim_winnings",
    [
      { type: "address", value: playerAddress },
      { type: "u64", value: betId },
    ],
    network()
  );
}

/** Build the dice.resolve_lost_bet XDR — finalises a lost bet in lumabet_core. */
export async function buildResolveLostBetTransaction(
  playerAddress: string,
  betId: bigint
): Promise<string> {
  return buildContractCall(
    playerAddress,
    diceContractId(),
    "resolve_lost_bet",
    [
      { type: "address", value: playerAddress },
      { type: "u64", value: betId },
    ],
    network()
  );
}

/**
 * Submit a signed transaction XDR and wait for confirmation.
 * Returns hash, ledger number, and the parsed return value (if any).
 */
export async function submitTransaction(signedXdr: string): Promise<SubmitResult> {
  return submitAndWait(signedXdr, network());
}

// ── Return-value parsing ──────────────────────────────────────────────────────

/** Parse the u64 bet_id returned by core.place_bet. */
export function parseBetId(result: SubmitResult): bigint | null {
  const val = result.returnValue;
  if (!val || val.switch().name !== "scvU64") return null;
  return BigInt(val.u64().toString());
}

export interface DiceRollResult {
  outcome: number;
  won: boolean;
}

/**
 * Parse the DiceRoll struct returned by dice.roll_dice.
 * ScVal layout: map with keys player/prediction/outcome/won/bet_id/timestamp.
 */
export function parseDiceRoll(result: SubmitResult): DiceRollResult | null {
  const val = result.returnValue;
  if (!val || val.switch().name !== "scvMap") return null;

  const map = val.map();
  if (!map) return null;

  let outcome: number | null = null;
  let won: boolean | null = null;

  for (const entry of map) {
    const key = entry.key().sym()?.toString();
    if (key === "outcome") outcome = Number(entry.val().u64()?.toString() ?? "0");
    if (key === "won") won = entry.val().switch().name === "scvBool" && entry.val().b();
  }

  if (outcome === null || won === null) return null;
  return { outcome, won };
}
