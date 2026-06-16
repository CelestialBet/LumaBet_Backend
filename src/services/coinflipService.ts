/**
 * coinflipService — business logic for the commit-reveal coin flip game.
 *
 * Responsibilities:
 *  - Validate commit / reveal inputs
 *  - Coordinate with stellarService for contract interactions
 *  - Persist and update records in coinflip_bets
 */

import { db } from "../db/client.js";
import {
  buildCommitTransaction,
  buildRevealTransaction,
  submitTransaction,
  listenForContractEvent,
  type SubmitResult,
} from "./stellarService.js";

const STROOPS_PER_XLM = 10_000_000n;
const MIN_BET_STROOPS = 1_000_000n; // 0.1 XLM
const MAX_BET_STROOPS = 5_000_000_000n; // 500 XLM

// ── Input / output types ──────────────────────────────────────────────────────

export interface CommitInput {
  playerAddress: string;
  commitmentHex: string; // sha256(secret) as 64-char hex
  betAmountXlm: string;  // human-readable XLM, e.g. "5.5"
  playerChoice: number;  // 0 = heads, 1 = tails
}

export interface CommitResult {
  commitXdr: string; // unsigned Soroban invocation XDR for Freighter to sign
  betDbId: string;   // UUID in coinflip_bets — client stores this for later
}

export interface RevealInput {
  playerAddress: string;
  secretHex: string;         // 64-char hex — the original 32-byte secret
  signedCommitXdr: string;   // Freighter-signed commit_bet XDR
  betDbId: string;           // UUID from CommitResult
}

export interface RevealPhase {
  revealXdr: string;         // unsigned reveal_bet XDR for Freighter to sign
  commitTxHash: string;      // commit tx hash for reference
}

export interface SettleInput {
  playerAddress: string;
  signedRevealXdr: string;
  betDbId: string;
}

export interface SettleResult {
  outcome: number;
  outcomeName: "HEADS" | "TAILS";
  won: boolean;
  payoutStroops: bigint | null;
  revealTxHash: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function xlmToStroops(xlm: string): bigint {
  const [whole, frac = ""] = xlm.split(".");
  const fracPadded = frac.padEnd(7, "0").slice(0, 7);
  return BigInt(whole ?? "0") * STROOPS_PER_XLM + BigInt(fracPadded);
}

function validateCommitInput(input: CommitInput): void {
  if (!/^[A-Z0-9]{56}$/.test(input.playerAddress)) {
    throw Object.assign(new Error("Invalid player address"), { status: 400 });
  }
  if (!/^[0-9a-f]{64}$/i.test(input.commitmentHex)) {
    throw Object.assign(new Error("commitment must be 32 bytes as hex (64 chars)"), { status: 400 });
  }
  if (input.playerChoice !== 0 && input.playerChoice !== 1) {
    throw Object.assign(new Error("playerChoice must be 0 (heads) or 1 (tails)"), { status: 400 });
  }
  const stroops = xlmToStroops(input.betAmountXlm);
  if (stroops < MIN_BET_STROOPS) {
    throw Object.assign(new Error("Minimum bet is 0.1 XLM"), { status: 400 });
  }
  if (stroops > MAX_BET_STROOPS) {
    throw Object.assign(new Error("Maximum bet is 500 XLM"), { status: 400 });
  }
}

// ── Phase 1: commit ───────────────────────────────────────────────────────────

/**
 * Validate the commit input, build the unsigned commit_bet XDR, and store a
 * pending record in coinflip_bets.
 *
 * The client must sign the returned XDR with Freighter and then call
 * processReveal() with the signed XDR.
 */
export async function processCommit(input: CommitInput): Promise<CommitResult> {
  validateCommitInput(input);

  const betStroops = xlmToStroops(input.betAmountXlm);
  const commitment = Buffer.from(input.commitmentHex, "hex");

  const commitXdr = await buildCommitTransaction(
    input.playerAddress,
    commitment,
    betStroops,
    input.playerChoice
  );

  // Store pending bet — status 'building' until commit tx is submitted
  const row = await db.query<{ id: string }>(
    `INSERT INTO coinflip_bets
       (player_address, game_type, bet_amount, player_choice, status, created_at)
     VALUES ($1, 'COIN_FLIP', $2, $3, 'building', NOW())
     RETURNING id`,
    [input.playerAddress, betStroops.toString(), input.playerChoice]
  );

  return {
    commitXdr,
    betDbId: row.rows[0]?.id ?? "",
  };
}

// ── Phase 2: submit commit + build reveal XDR ─────────────────────────────────

/**
 * Submit the signed commit_bet transaction, then build the unsigned reveal_bet
 * XDR for the player to sign next.
 */
export async function processReveal(input: RevealInput): Promise<RevealPhase> {
  if (!/^[0-9a-f]{64}$/i.test(input.secretHex)) {
    throw Object.assign(new Error("secret must be 32 bytes as hex (64 chars)"), { status: 400 });
  }

  // Submit the signed commit transaction
  let commitResponse: SubmitResult;
  try {
    commitResponse = await submitTransaction(input.signedCommitXdr);
  } catch (err) {
    throw Object.assign(
      new Error(err instanceof Error ? err.message : "Commit transaction failed"),
      { status: 422 }
    );
  }

  // Record the commit tx hash
  const commitTxHash = commitResponse.hash;
  await db.query(
    `UPDATE coinflip_bets SET status = 'committed', commit_tx_hash = $1 WHERE id = $2`,
    [commitTxHash, input.betDbId]
  );

  // Build the reveal XDR for the player to sign
  const secret = Buffer.from(input.secretHex, "hex");
  const revealXdr = await buildRevealTransaction(input.playerAddress, secret);

  return { revealXdr, commitTxHash };
}

// ── Phase 3: submit reveal + settle ──────────────────────────────────────────

/**
 * Submit the signed reveal_bet transaction, poll for the on-chain `Revealed`
 * event, update coinflip_bets with the outcome, and return the result.
 */
export async function settleReveal(input: SettleInput): Promise<SettleResult> {
  let revealResponse: SubmitResult;
  try {
    revealResponse = await submitTransaction(input.signedRevealXdr);
  } catch (err) {
    throw Object.assign(
      new Error(err instanceof Error ? err.message : "Reveal transaction failed"),
      { status: 422 }
    );
  }

  const revealTxHash = revealResponse.hash;
  const ledger = revealResponse.ledger;

  // Parse CoinResult return value from the transaction directly if available
  let outcome: number | null = null;
  let won: boolean | null = null;
  let payoutStroops: bigint | null = null;

  const retVal = revealResponse.returnValue ?? null;
  if (retVal?.switch().name === "scvMap") {
    const map = retVal.map() ?? [];
    for (const entry of map) {
      const key = entry.key().sym()?.toString();
      if (key === "outcome") outcome = Number(entry.val().u64()?.toString() ?? "0");
      if (key === "won") won = entry.val().b();
    }
  }

  // Fallback: poll getEvents if return value wasn't parseable
  if (outcome === null) {
    const event = await listenForContractEvent(input.playerAddress, ledger - 1);
    if (event) {
      outcome = event.outcome;
      won = event.won;
    }
  }

  // Compute payout if won
  if (won && outcome !== null) {
    const betRow = await db.query<{ bet_amount: string }>(
      `SELECT bet_amount FROM coinflip_bets WHERE id = $1`,
      [input.betDbId]
    );
    if (betRow.rows[0]) {
      const bet = BigInt(betRow.rows[0].bet_amount);
      // 2× gross minus 2% house edge = 1.96×
      payoutStroops = (bet * 196n) / 100n;
    }
  }

  const status = won ? "won" : "lost";
  await db.query(
    `UPDATE coinflip_bets SET
       status         = $1,
       outcome        = $2,
       payout_amount  = $3,
       reveal_tx_hash = $4,
       resolved_at    = NOW()
     WHERE id = $5`,
    [status, outcome, payoutStroops?.toString() ?? null, revealTxHash, input.betDbId]
  );

  return {
    outcome: outcome ?? 0,
    outcomeName: outcome === 0 ? "HEADS" : "TAILS",
    won: won ?? false,
    payoutStroops,
    revealTxHash,
  };
}
