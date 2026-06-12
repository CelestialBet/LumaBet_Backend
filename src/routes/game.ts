import { Router } from "express";
import { z } from "zod";
import { submitTransaction, buildPaymentTransaction } from "../lib/stellar-client/index.js";
import { NetworkType, BetStatus, GameType } from "../types/index.js";
import { DICE_CONFIG } from "../config/index.js";
import { db } from "../db/client.js";
import { AppError } from "../middleware/errorHandler.js";

export const gameRouter: Router = Router();

// ── Validation Schemas ────────────────────────────────────────────────────────

const PlaceDiceBetSchema = z.object({
  playerPublicKey: z.string().length(56),
  amountXlm: z
    .string()
    .regex(/^\d+(\.\d{1,7})?$/, "Invalid XLM amount")
    .refine(
      (v) => parseFloat(v) >= parseFloat(DICE_CONFIG.minBetXlm),
      `Minimum bet is ${DICE_CONFIG.minBetXlm} XLM`
    )
    .refine(
      (v) => parseFloat(v) <= parseFloat(DICE_CONFIG.maxBetXlm),
      `Maximum bet is ${DICE_CONFIG.maxBetXlm} XLM`
    ),
  prediction: z.number().int().min(1).max(6),
  signedXdr: z.string().min(1),
});

const HistoryQuerySchema = z.object({
  playerPublicKey: z.string().length(56).optional(),
  gameType: z.nativeEnum(GameType).optional(),
  status: z.nativeEnum(BetStatus).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const PrepareSchema = z.object({
  playerPublicKey: z.string().length(56),
  amountXlm: z
    .string()
    .regex(/^\d+(\.\d{1,7})?$/, "Invalid XLM amount")
    .refine((v) => parseFloat(v) >= parseFloat(DICE_CONFIG.minBetXlm), `Minimum bet is ${DICE_CONFIG.minBetXlm} XLM`)
    .refine((v) => parseFloat(v) <= parseFloat(DICE_CONFIG.maxBetXlm), `Maximum bet is ${DICE_CONFIG.maxBetXlm} XLM`),
  prediction: z.number().int().min(1).max(6),
});

// ── POST /game/dice/prepare — Build unsigned transaction for the player to sign

gameRouter.post("/dice/prepare", async (req, res, next) => {
  try {
    const body = PrepareSchema.parse(req.body);
    const network = (process.env["STELLAR_NETWORK"] as NetworkType) ?? NetworkType.TESTNET;

    const coreContractId = process.env["LUMABET_CORE_CONTRACT_ID"];
    if (!coreContractId) {
      throw new AppError(503, "Core contract not configured — set LUMABET_CORE_CONTRACT_ID", "CONTRACT_NOT_CONFIGURED");
    }

    // Build a payment transaction to the contract escrow address.
    // The memo encodes game type and prediction for the resolver.
    const xdr = await buildPaymentTransaction(
      body.playerPublicKey,
      coreContractId,
      body.amountXlm,
      `DICE:${body.prediction}`,
      network
    );

    res.json({ xdr, contractId: coreContractId });
  } catch (err) {
    next(err);
  }
});

// ── POST /game/dice — Place a dice bet ────────────────────────────────────────

gameRouter.post("/dice", async (req, res, next) => {
  try {
    const body = PlaceDiceBetSchema.parse(req.body);
    const network = (process.env["STELLAR_NETWORK"] as NetworkType) ?? NetworkType.TESTNET;

    // Submit the signed transaction to Stellar
    const result = await submitTransaction(body.signedXdr, network);
    if (!result.success) {
      throw new AppError(422, result.error ?? "Transaction failed", "TX_FAILED");
    }

    // Persist the bet to the database
    const betResult = await db.query<{ id: string }>(
      `INSERT INTO bets
         (player_public_key, game_type, prediction, amount_xlm, status, transaction_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id`,
      [
        body.playerPublicKey,
        GameType.DICE,
        body.prediction,
        body.amountXlm,
        BetStatus.PENDING,
        result.transactionHash,
      ]
    );

    res.status(201).json({
      betId: betResult.rows[0]?.id,
      transactionHash: result.transactionHash,
      status: BetStatus.PENDING,
      message: "Bet placed successfully. Waiting for resolution.",
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /game/history — Bet history ──────────────────────────────────────────

gameRouter.get("/history", async (req, res, next) => {
  try {
    const query = HistoryQuerySchema.parse(req.query);

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (query.playerPublicKey) {
      conditions.push(`player_public_key = $${paramIndex++}`);
      params.push(query.playerPublicKey);
    }
    if (query.gameType) {
      conditions.push(`game_type = $${paramIndex++}`);
      params.push(query.gameType);
    }
    if (query.status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(query.status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM bets ${where}`,
      params
    );

    params.push(query.limit, query.offset);
    const betsResult = await db.query(
      `SELECT
         id, player_public_key, game_type, prediction, amount_xlm,
         outcome, status, payout_xlm, transaction_hash, created_at, resolved_at
       FROM bets ${where}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );

    res.json({
      data: betsResult.rows,
      total: parseInt(countResult.rows[0]?.count ?? "0", 10),
      limit: query.limit,
      offset: query.offset,
    });
  } catch (err) {
    next(err);
  }
});
