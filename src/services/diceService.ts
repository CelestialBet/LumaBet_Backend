/**
 * diceService — business logic for the three-phase dice game.
 *
 * Responsibilities:
 *  - Validate place / roll / resolve inputs
 *  - Coordinate with diceStellarService for contract interactions
 *  - Persist and update records in dice_bets
 */

import { randomBytes } from "node:crypto";
import { db } from "../db/client.js";
import {
  buildPlaceBetTransaction,
  buildRollDiceTransaction,
  buildClaimWinningsTransaction,
  buildResolveLostBetTransaction,
  submitTransaction,
  parseBetId,
  parseDiceRoll,
} from "./diceStellarService.js";

const STROOPS_PER_XLM = 10_000_000n;
const MIN_BET_STROOPS = 10_000_000n; // 1 XLM
const MAX_BET_STROOPS = 10_000_000_000n; // 1000 XLM
const PAYOUT_MULTIPLIER_BPS = 50_000n; // 5x gross
const HOUSE_EDGE_BPS = 200n; // 2%

// ── Input / output types ──────────────────────────────────────────────────────

export interface PlaceInput {
  playerAddress: string;
  amountXlm: string;
  prediction: number; // 1-6
}

export interface PlaceResult {
  placeXdr: string;
  betDbId: string;
}

export interface RollInput {
  playerAddress: string;
  betDbId: string;
  signedPlaceXdr: string;
}

export interface RollResult {
  rollXdr: string;
  onChainBetId: string;
  placeTxHash: string;
}

export interface ResolveInput {
  playerAddress: string;
  betDbId: string;
  signedRollXdr: string;
}

export interface ResolveResult {
  resolveXdr: string;
  outcome: number;
  won: boolean;
  rollTxHash: string;
}

export interface FinalizeInput {
  playerAddress: string;
  betDbId: string;
  signedResolveXdr: string;
}

export interface FinalizeResult {
  outcome: number;
  won: boolean;
  payoutStroops: bigint | null;
  status: "won" | "lost";
  resolveTxHash: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function xlmToStroops(xlm: string): bigint {
  const [whole, frac = ""] = xlm.split(".");
  const fracPadded = frac.padEnd(7, "0").slice(0, 7);
  return BigInt(whole ?? "0") * STROOPS_PER_XLM + BigInt(fracPadded);
}

function validatePlaceInput(input: PlaceInput): void {
  if (!/^[A-Z0-9]{56}$/.test(input.playerAddress)) {
    throw Object.assign(new Error("Invalid player address"), { status: 400 });
  }
  if (!Number.isInteger(input.prediction) || input.prediction < 1 || input.prediction > 6) {
    throw Object.assign(new Error("prediction must be an integer 1-6"), { status: 400 });
  }
  const stroops = xlmToStroops(input.amountXlm);
  if (stroops < MIN_BET_STROOPS) {
    throw Object.assign(new Error("Minimum bet is 1 XLM"), { status: 400 });
  }
  if (stroops > MAX_BET_STROOPS) {
    throw Object.assign(new Error("Maximum bet is 1000 XLM"), { status: 400 });
  }
}

async function loadBet(betDbId: string): Promise<{
  prediction: number;
  on_chain_bet_id: string | null;
  bet_amount: string;
} | null> {
  const row = await db.query<{ prediction: number; on_chain_bet_id: string | null; bet_amount: string }>(
    `SELECT prediction, on_chain_bet_id, bet_amount FROM dice_bets WHERE id = $1`,
    [betDbId]
  );
  return row.rows[0] ?? null;
}

// ── Phase 1: place ────────────────────────────────────────────────────────────

/**
 * Validate the bet, build the unsigned place_bet XDR, and store a pending
 * record in dice_bets. The client must sign with Freighter, then call
 * processRoll() with the signed XDR.
 */
export async function processPlace(input: PlaceInput): Promise<PlaceResult> {
  validatePlaceInput(input);

  const betStroops = xlmToStroops(input.amountXlm);

  const placeXdr = await buildPlaceBetTransaction(input.playerAddress, betStroops, input.prediction);

  const row = await db.query<{ id: string }>(
    `INSERT INTO dice_bets
       (player_address, game_type, bet_amount, prediction, status, created_at)
     VALUES ($1, 'DICE', $2, $3, 'building', NOW())
     RETURNING id`,
    [input.playerAddress, betStroops.toString(), input.prediction]
  );

  return { placeXdr, betDbId: row.rows[0]?.id ?? "" };
}

// ── Phase 2: submit place_bet + build roll_dice XDR ───────────────────────────

/**
 * Submit the signed place_bet transaction, extract the on-chain bet_id, and
 * build the unsigned roll_dice XDR for the player to sign next.
 */
export async function processRoll(input: RollInput): Promise<RollResult> {
  const bet = await loadBet(input.betDbId);
  if (!bet) {
    throw Object.assign(new Error("Bet not found"), { status: 404 });
  }

  let placeResponse;
  try {
    placeResponse = await submitTransaction(input.signedPlaceXdr);
  } catch (err) {
    throw Object.assign(
      new Error(err instanceof Error ? err.message : "place_bet transaction failed"),
      { status: 422 }
    );
  }

  const onChainBetId = parseBetId(placeResponse);
  if (onChainBetId === null) {
    throw Object.assign(new Error("Could not read bet_id from place_bet return value"), { status: 422 });
  }

  await db.query(
    `UPDATE dice_bets SET status = 'placed', on_chain_bet_id = $1, place_tx_hash = $2 WHERE id = $3`,
    [onChainBetId.toString(), placeResponse.hash, input.betDbId]
  );

  // Fresh random seed mixed into lumabet_rng along with ledger state.
  const seed = randomBytes(8).readBigUInt64BE(0);

  const rollXdr = await buildRollDiceTransaction(input.playerAddress, onChainBetId, bet.prediction, seed);

  return { rollXdr, onChainBetId: onChainBetId.toString(), placeTxHash: placeResponse.hash };
}

// ── Phase 3: submit roll_dice + build claim/resolve XDR ───────────────────────

/**
 * Submit the signed roll_dice transaction, parse the outcome, and build the
 * unsigned claim_winnings (won) or resolve_lost_bet (lost) XDR to finalise
 * the bet in lumabet_core.
 */
export async function processResolve(input: ResolveInput): Promise<ResolveResult> {
  const bet = await loadBet(input.betDbId);
  if (!bet || !bet.on_chain_bet_id) {
    throw Object.assign(new Error("Bet not found or not yet placed"), { status: 404 });
  }

  let rollResponse;
  try {
    rollResponse = await submitTransaction(input.signedRollXdr);
  } catch (err) {
    throw Object.assign(
      new Error(err instanceof Error ? err.message : "roll_dice transaction failed"),
      { status: 422 }
    );
  }

  const roll = parseDiceRoll(rollResponse);
  if (!roll) {
    throw Object.assign(new Error("Could not read DiceRoll from roll_dice return value"), { status: 422 });
  }

  await db.query(
    `UPDATE dice_bets SET outcome = $1, won = $2, roll_tx_hash = $3 WHERE id = $4`,
    [roll.outcome, roll.won, rollResponse.hash, input.betDbId]
  );

  const onChainBetId = BigInt(bet.on_chain_bet_id);
  const resolveXdr = roll.won
    ? await buildClaimWinningsTransaction(input.playerAddress, onChainBetId)
    : await buildResolveLostBetTransaction(input.playerAddress, onChainBetId);

  return { resolveXdr, outcome: roll.outcome, won: roll.won, rollTxHash: rollResponse.hash };
}

// ── Phase 4: submit claim/resolve + finalise in DB ────────────────────────────

/**
 * Submit the signed claim_winnings / resolve_lost_bet transaction and record
 * the final outcome in dice_bets.
 */
export async function processFinalize(input: FinalizeInput): Promise<FinalizeResult> {
  const bet = await db.query<{ outcome: number | null; won: boolean | null; bet_amount: string }>(
    `SELECT outcome, won, bet_amount FROM dice_bets WHERE id = $1`,
    [input.betDbId]
  );
  const row = bet.rows[0];
  if (!row || row.outcome === null || row.won === null) {
    throw Object.assign(new Error("Bet not found or not yet rolled"), { status: 404 });
  }

  let resolveResponse;
  try {
    resolveResponse = await submitTransaction(input.signedResolveXdr);
  } catch (err) {
    throw Object.assign(
      new Error(err instanceof Error ? err.message : "resolve transaction failed"),
      { status: 422 }
    );
  }

  let payoutStroops: bigint | null = null;
  if (row.won) {
    const betAmount = BigInt(row.bet_amount);
    const gross = (betAmount * PAYOUT_MULTIPLIER_BPS) / 10_000n;
    const cut = (gross * HOUSE_EDGE_BPS) / 10_000n;
    payoutStroops = gross - cut;
  }

  const status = row.won ? "won" : "lost";
  await db.query(
    `UPDATE dice_bets SET
       status          = $1,
       payout_amount   = $2,
       resolve_tx_hash = $3,
       resolved_at     = NOW()
     WHERE id = $4`,
    [status, payoutStroops?.toString() ?? null, resolveResponse.hash, input.betDbId]
  );

  return {
    outcome: row.outcome,
    won: row.won,
    payoutStroops,
    status,
    resolveTxHash: resolveResponse.hash,
  };
}
