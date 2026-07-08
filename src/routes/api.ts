/**
 * /api/games — service-layer routes used by the new frontend components.
 *
 * Three-phase coin flip flow:
 *   POST /api/games/coinflip/commit   → returns unsigned commit XDR + betDbId
 *   POST /api/games/coinflip/reveal   → submits signed commit, returns unsigned reveal XDR
 *   POST /api/games/coinflip/settle   → submits signed reveal, returns outcome
 *   GET  /api/games/coinflip/history  → paginated coinflip_bets for a player
 *
 * Four-phase dice flow (spans lumabet_core + lumabet_dice, each step is a
 * separate player-signed transaction — see docs/architecture.md):
 *   POST /api/games/dice/place    → returns unsigned place_bet XDR + betDbId
 *   POST /api/games/dice/roll     → submits signed place_bet, returns unsigned roll_dice XDR
 *   POST /api/games/dice/resolve  → submits signed roll_dice, returns unsigned claim/resolve XDR
 *   POST /api/games/dice/finalize → submits signed claim/resolve, returns final outcome
 *   GET  /api/games/dice/history  → paginated dice_bets for a player
 */

import { Router } from "express";
import { z } from "zod";
import { processCommit, processReveal, settleReveal } from "../services/coinflipService.js";
import { processPlace, processRoll, processResolve, processFinalize } from "../services/diceService.js";
import { db } from "../db/client.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  commitLimiter,
  validateCommit,
  validateReveal,
  handleValidationErrors,
} from "../middleware/security.js";

export const apiRouter: Router = Router();

// ── Schemas ───────────────────────────────────────────────────────────────────

const CommitBody = z.object({
  playerAddress: z.string().length(56),
  commitmentHex: z.string().length(64),
  betAmountXlm: z
    .string()
    .regex(/^\d+(\.\d{1,7})?$/)
    .refine((v) => parseFloat(v) >= 0.1, "Minimum bet is 0.1 XLM")
    .refine((v) => parseFloat(v) <= 500, "Maximum bet is 500 XLM"),
  playerChoice: z.number().int().min(0).max(1),
});

const RevealBody = z.object({
  playerAddress: z.string().length(56),
  secretHex: z.string().length(64),
  signedCommitXdr: z.string().min(1),
  betDbId: z.string().uuid(),
});

const SettleBody = z.object({
  playerAddress: z.string().length(56),
  signedRevealXdr: z.string().min(1),
  betDbId: z.string().uuid(),
});

const HistoryQuery = z.object({
  playerAddress: z.string().length(56),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const DicePlaceBody = z.object({
  playerAddress: z.string().length(56),
  amountXlm: z
    .string()
    .regex(/^\d+(\.\d{1,7})?$/)
    .refine((v) => parseFloat(v) >= 1, "Minimum bet is 1 XLM")
    .refine((v) => parseFloat(v) <= 1000, "Maximum bet is 1000 XLM"),
  prediction: z.number().int().min(1).max(6),
});

const DiceRollBody = z.object({
  playerAddress: z.string().length(56),
  betDbId: z.string().uuid(),
  signedPlaceXdr: z.string().min(1),
});

const DiceResolveBody = z.object({
  playerAddress: z.string().length(56),
  betDbId: z.string().uuid(),
  signedRollXdr: z.string().min(1),
});

const DiceFinalizeBody = z.object({
  playerAddress: z.string().length(56),
  betDbId: z.string().uuid(),
  signedResolveXdr: z.string().min(1),
});

// ── POST /api/games/coinflip/commit ──────────────────────────────────────────

apiRouter.post("/coinflip/commit", commitLimiter, ...validateCommit, handleValidationErrors, async (req, res, next) => {
  try {
    const body = CommitBody.parse(req.body);
    const result = await processCommit(body);
    res.status(201).json(result);
  } catch (err) {
    if (err && typeof err === "object" && "status" in err && err instanceof Error) {
      return next(new AppError((err as unknown as { status: number }).status, err.message, "VALIDATION_ERROR"));
    }
    next(err);
  }
});

// ── POST /api/games/coinflip/reveal ──────────────────────────────────────────

apiRouter.post("/coinflip/reveal", ...validateReveal, handleValidationErrors, async (req, res, next) => {
  try {
    const body = RevealBody.parse(req.body);
    const result = await processReveal(body);
    res.json(result);
  } catch (err) {
    if (err && typeof err === "object" && "status" in err && err instanceof Error) {
      return next(new AppError((err as unknown as { status: number }).status, err.message, "TX_ERROR"));
    }
    next(err);
  }
});

// ── POST /api/games/coinflip/settle ──────────────────────────────────────────

apiRouter.post("/coinflip/settle", async (req, res, next) => {
  try {
    const body = SettleBody.parse(req.body);
    const result = await settleReveal(body);
    // payoutStroops is bigint — convert to string for JSON serialization
    res.json({ ...result, payoutStroops: result.payoutStroops?.toString() ?? null });
  } catch (err) {
    if (err && typeof err === "object" && "status" in err && err instanceof Error) {
      return next(new AppError((err as unknown as { status: number }).status, err.message, "TX_ERROR"));
    }
    next(err);
  }
});

// ── GET /api/games/coinflip/status/:address ──────────────────────────────────

apiRouter.get("/coinflip/status/:address", async (req, res, next) => {
  try {
    const address = req.params["address"] ?? "";
    if (!/^[A-Z0-9]{56}$/.test(address)) {
      throw new AppError(400, "Invalid Stellar address", "INVALID_ADDRESS");
    }

    const result = await db.query(
      `SELECT * FROM coinflip_bets
       WHERE player_address = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [address]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "No bet found for this address" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/games/coinflip/cancel ──────────────────────────────────────────

const CANCEL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes (matches ~100 ledgers)

const CancelBody = z.object({
  playerAddress: z.string().length(56),
  betDbId: z.string().uuid(),
});

apiRouter.post("/coinflip/cancel", async (req, res, next) => {
  try {
    const body = CancelBody.parse(req.body);

    const betResult = await db.query<{ status: string; created_at: string }>(
      `SELECT status, created_at
       FROM coinflip_bets
       WHERE id = $1 AND player_address = $2`,
      [body.betDbId, body.playerAddress]
    );

    const bet = betResult.rows[0];
    if (!bet) {
      throw new AppError(404, "Bet not found", "NOT_FOUND");
    }
    if (bet.status !== "committed" && bet.status !== "building") {
      throw new AppError(409, "Bet cannot be cancelled in its current state", "INVALID_STATE");
    }

    const ageMs = Date.now() - new Date(bet.created_at).getTime();
    if (ageMs < CANCEL_TIMEOUT_MS) {
      throw new AppError(403, "Cannot cancel yet — wait for timeout period", "TOO_EARLY");
    }

    await db.query(
      `UPDATE coinflip_bets SET status = 'cancelled', resolved_at = NOW() WHERE id = $1`,
      [body.betDbId]
    );

    res.json({
      status: "cancelled",
      betDbId: body.betDbId,
      message: "Bet cancelled. Stake will be refunded by the contract.",
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/games/coinflip/history ──────────────────────────────────────────

apiRouter.get("/coinflip/history", async (req, res, next) => {
  try {
    const query = HistoryQuery.parse(req.query);

    const countResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM coinflip_bets WHERE player_address = $1`,
      [query.playerAddress]
    );

    const rows = await db.query(
      `SELECT
         id, player_address, game_type, bet_amount, player_choice,
         outcome, payout_amount, status, commit_tx_hash, reveal_tx_hash,
         created_at, resolved_at
       FROM coinflip_bets
       WHERE player_address = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [query.playerAddress, query.limit, query.offset]
    );

    res.json({
      data: rows.rows,
      total: parseInt(countResult.rows[0]?.count ?? "0", 10),
      limit: query.limit,
      offset: query.offset,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/games/dice/place ───────────────────────────────────────────────

apiRouter.post("/dice/place", async (req, res, next) => {
  try {
    const body = DicePlaceBody.parse(req.body);
    const result = await processPlace(body);
    res.status(201).json(result);
  } catch (err) {
    if (err && typeof err === "object" && "status" in err && err instanceof Error) {
      return next(new AppError((err as unknown as { status: number }).status, err.message, "VALIDATION_ERROR"));
    }
    next(err);
  }
});

// ── POST /api/games/dice/roll ─────────────────────────────────────────────────

apiRouter.post("/dice/roll", async (req, res, next) => {
  try {
    const body = DiceRollBody.parse(req.body);
    const result = await processRoll(body);
    res.json(result);
  } catch (err) {
    if (err && typeof err === "object" && "status" in err && err instanceof Error) {
      return next(new AppError((err as unknown as { status: number }).status, err.message, "TX_ERROR"));
    }
    next(err);
  }
});

// ── POST /api/games/dice/resolve ─────────────────────────────────────────────

apiRouter.post("/dice/resolve", async (req, res, next) => {
  try {
    const body = DiceResolveBody.parse(req.body);
    const result = await processResolve(body);
    res.json(result);
  } catch (err) {
    if (err && typeof err === "object" && "status" in err && err instanceof Error) {
      return next(new AppError((err as unknown as { status: number }).status, err.message, "TX_ERROR"));
    }
    next(err);
  }
});

// ── POST /api/games/dice/finalize ────────────────────────────────────────────

apiRouter.post("/dice/finalize", async (req, res, next) => {
  try {
    const body = DiceFinalizeBody.parse(req.body);
    const result = await processFinalize(body);
    res.json({ ...result, payoutStroops: result.payoutStroops?.toString() ?? null });
  } catch (err) {
    if (err && typeof err === "object" && "status" in err && err instanceof Error) {
      return next(new AppError((err as unknown as { status: number }).status, err.message, "TX_ERROR"));
    }
    next(err);
  }
});

// ── GET /api/games/dice/status/:address ──────────────────────────────────────

apiRouter.get("/dice/status/:address", async (req, res, next) => {
  try {
    const address = req.params["address"] ?? "";
    if (!/^[A-Z0-9]{56}$/.test(address)) {
      throw new AppError(400, "Invalid Stellar address", "INVALID_ADDRESS");
    }

    const result = await db.query(
      `SELECT * FROM dice_bets
       WHERE player_address = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [address]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "No bet found for this address" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/games/dice/history ──────────────────────────────────────────────

apiRouter.get("/dice/history", async (req, res, next) => {
  try {
    const query = HistoryQuery.parse(req.query);

    const countResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM dice_bets WHERE player_address = $1`,
      [query.playerAddress]
    );

    const rows = await db.query(
      `SELECT
         id, player_address, game_type, bet_amount, prediction, on_chain_bet_id,
         outcome, won, payout_amount, status, place_tx_hash, roll_tx_hash,
         resolve_tx_hash, created_at, resolved_at
       FROM dice_bets
       WHERE player_address = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [query.playerAddress, query.limit, query.offset]
    );

    res.json({
      data: rows.rows,
      total: parseInt(countResult.rows[0]?.count ?? "0", 10),
      limit: query.limit,
      offset: query.offset,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/stats ────────────────────────────────────────────────────────────
// Returns aggregate economic stats from the database.
// For contract-level stats (house balance) see GET /api/stats/contract.

apiRouter.get("/stats", async (_req, res, next) => {
  try {
    const result = await db.query<{
      total_bets: string;
      total_wagered: string;
      total_paid_out: string;
      active_bets: string;
    }>(`
      SELECT
        COUNT(*)                                            AS total_bets,
        COALESCE(SUM(bet_amount), 0)                       AS total_wagered,
        COALESCE(SUM(CASE WHEN status = 'won' THEN payout_amount ELSE 0 END), 0)
                                                           AS total_paid_out,
        COUNT(CASE WHEN status IN ('building','committed') THEN 1 END)
                                                           AS active_bets
      FROM coinflip_bets
    `);

    const row = result.rows[0];
    const totalWagered = BigInt(row?.total_wagered ?? "0");
    const totalPaidOut = BigInt(row?.total_paid_out ?? "0");
    const houseProfit = totalWagered - totalPaidOut;

    const stroopsToXlm = (stroops: bigint) =>
      (Number(stroops) / 10_000_000).toFixed(7) + " XLM";

    res.json({
      totalBets: parseInt(row?.total_bets ?? "0", 10),
      totalWagered: stroopsToXlm(totalWagered),
      totalPaidOut: stroopsToXlm(totalPaidOut),
      houseProfit: stroopsToXlm(houseProfit),
      houseBalance: "see /api/stats/contract for on-chain balance",
      activeBets: parseInt(row?.active_bets ?? "0", 10),
    });
  } catch (err) {
    next(err);
  }
});
