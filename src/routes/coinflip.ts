import { Router } from "express";
import { z } from "zod";
import { NetworkType, GameType, BetStatus } from "../types/index.js";
import { HOUSE_EDGE_BPS, STROOPS_PER_XLM } from "../config/index.js";
import { db } from "../db/client.js";
import { AppError } from "../middleware/errorHandler.js";
import { buildContractCall, submitAndWait } from "../lib/stellar-client/soroban.js";
import { submitTransaction } from "../lib/stellar-client/index.js";

export const coinFlipRouter: Router = Router();

const COIN_FLIP_MIN_XLM = "0.1";
const COIN_FLIP_MAX_XLM = "500";

// ── Validation schemas ────────────────────────────────────────────────────────

const PrepareCommitSchema = z.object({
  playerPublicKey: z.string().length(56),
  amountXlm: z
    .string()
    .regex(/^\d+(\.\d{1,7})?$/)
    .refine((v) => parseFloat(v) >= parseFloat(COIN_FLIP_MIN_XLM), `Minimum bet is ${COIN_FLIP_MIN_XLM} XLM`)
    .refine((v) => parseFloat(v) <= parseFloat(COIN_FLIP_MAX_XLM), `Maximum bet is ${COIN_FLIP_MAX_XLM} XLM`),
  commitmentHex: z.string().length(64, "commitment must be 32 bytes as hex (64 chars)"),
  prediction: z.number().int().min(0).max(1),
});

const CommitSchema = PrepareCommitSchema.extend({
  signedXdr: z.string().min(1),
});

const PrepareRevealSchema = z.object({
  playerPublicKey: z.string().length(56),
  secretHex: z.string().length(64, "secret must be 32 bytes as hex (64 chars)"),
});

const RevealSchema = PrepareRevealSchema.extend({
  signedXdr: z.string().min(1),
});

// ── Helpers ───────────────────────────────────="────────────────────────────────

function getCoinFlipContractId(): string {
  const id = process.env["LUMABET_COIN_FLIP_CONTRACT_ID"];
  if (!id) throw new AppError(503, "Coin flip contract not configured", "CONTRACT_NOT_CONFIGURED");
  return id;
}

function getNetwork(): NetworkType {
  return (process.env["STELLAR_NETWORK"] as NetworkType) ?? NetworkType.TESTNET;
}

function xlmToStroops(xlm: string): bigint {
  const [whole, frac = ""] = xlm.split(".");
  const fracPadded = frac.padEnd(7, "0").slice(0, 7);
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(fracPadded);
}

function stroopsToXlm(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_XLM;
  const frac = stroops % STROOPS_PER_XLM;
  return `${whole}.${frac.toString().padStart(7, "0")}`;
}

// ── POST /game/coinflip/prepare-commit ───────────────────────────────────────
// Build the commit_bet contract invocation XDR for the player to sign.

coinFlipRouter.post("/prepare-commit", async (req, res, next) => {
  try {
    const body = PrepareCommitSchema.parse(req.body);
    const network = getNetwork();
    const contractId = getCoinFlipContractId();

    const amountStroops = xlmToStroops(body.amountXlm);
    const commitmentBytes = Buffer.from(body.commitmentHex, "hex");

    const xdr = await buildContractCall(
      body.playerPublicKey,
      contractId,
      "commit_bet",
      [
        { type: "address", value: body.playerPublicKey },
        { type: "bytes", value: commitmentBytes },
        { type: "i128", value: amountStroops },
        { type: "u64", value: BigInt(body.prediction) },
      ],
      network
    );

    res.json({ xdr, contractId });
  } catch (err) {
    next(err);
  }
});

// ── POST /game/coinflip/commit ────────────────────────────────────────────────
// Submit signed commit_bet transaction and record pending bet in DB.

coinFlipRouter.post("/commit", async (req, res, next) => {
  try {
    const body = CommitSchema.parse(req.body);
    const network = getNetwork();

    const result = await submitTransaction(body.signedXdr, network);
    if (!result.success) {
      throw new AppError(422, result.error ?? "Transaction failed", "TX_FAILED");
    }

    // Upsert player row
    await db.query(
      `INSERT INTO players (public_key) VALUES ($1)
       ON CONFLICT (public_key) DO NOTHING`,
      [body.playerPublicKey]
    );

    // Record the pending bet
    const betResult = await db.query<{ id: string }>(
      `INSERT INTO bets
         (player_public_key, game_type, prediction, amount_xlm, status, transaction_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id`,
      [
        body.playerPublicKey,
        GameType.COIN_FLIP,
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
      message: "Commitment recorded. Send your secret to reveal the outcome.",
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /game/coinflip/prepare-reveal ───────────────────────────────────────
// Build the reveal_bet contract invocation XDR for the player to sign.

coinFlipRouter.post("/prepare-reveal", async (req, res, next) => {
  try {
    const body = PrepareRevealSchema.parse(req.body);
    const network = getNetwork();
    const contractId = getCoinFlipContractId();

    const secretBytes = Buffer.from(body.secretHex, "hex");

    const xdr = await buildContractCall(
      body.playerPublicKey,
      contractId,
      "reveal_bet",
      [
        { type: "address", value: body.playerPublicKey },
        { type: "bytes", value: secretBytes },
      ],
      network
    );

    res.json({ xdr });
  } catch (err) {
    next(err);
  }
});

// ── POST /game/coinflip/reveal ────────────────────────────────────────────────
// Submit signed reveal_bet transaction and update DB with outcome.

coinFlipRouter.post("/reveal", async (req, res, next) => {
  try {
    const body = RevealSchema.parse(req.body);
    const network = getNetwork();

    let txResponse;
    try {
      txResponse = await submitAndWait(body.signedXdr, network);
    } catch (err) {
      throw new AppError(422, err instanceof Error ? err.message : "Reveal failed", "TX_FAILED");
    }

    // Parse the CoinResult returned by reveal_bet.
    // ScVal structure: struct with fields [player, prediction, outcome, won, bet_id, timestamp]
    const returnVal = txResponse.returnValue;
    let outcome: number | null = null;
    let won: boolean | null = null;

    if (returnVal?.switch().name === "scvMap") {
      const map = returnVal.map();
      if (map) {
        for (const entry of map) {
          const key = entry.key().sym()?.toString();
          if (key === "outcome") {
            outcome = Number(entry.val().u64()?.toString() ?? "0");
          } else if (key === "won") {
            won = entry.val().switch().name === "scvBool" && entry.val().b();
          }
        }
      }
    }

    // Calculate payout display
    let payoutXlm: string | null = null;
    if (won !== null && won) {
      // DB holds the original bet — look it up to compute payout display
      const betRow = await db.query<{ amount_xlm: string }>(
        `SELECT amount_xlm FROM bets
         WHERE player_public_key = $1 AND game_type = $2 AND status = $3
         ORDER BY created_at DESC LIMIT 1`,
        [body.playerPublicKey, GameType.COIN_FLIP, BetStatus.PENDING]
      );
      if (betRow.rows[0]) {
        const betStroops = xlmToStroops(betRow.rows[0].amount_xlm);
        const gross = betStroops * 2n;
        const cut = (gross * BigInt(HOUSE_EDGE_BPS)) / 10_000n;
        payoutXlm = stroopsToXlm(gross - cut);
      }
    }

    const resolvedStatus = won ? BetStatus.WON : BetStatus.LOST;

    // Update the most recent PENDING coinflip bet for this player
    await db.query(
      `UPDATE bets SET
         status = $1,
         outcome = $2,
         payout_xlm = $3,
         resolved_at = NOW()
       WHERE id = (
         SELECT id FROM bets
         WHERE player_public_key = $4
           AND game_type = $5
           AND status = $6
         ORDER BY created_at DESC
         LIMIT 1
       )`,
      [
        resolvedStatus,
        outcome,
        payoutXlm,
        body.playerPublicKey,
        GameType.COIN_FLIP,
        BetStatus.PENDING,
      ]
    );

    // Update player stats
    await db.query(
      `UPDATE players SET
         total_bets    = total_bets + 1,
         total_won     = total_won + CASE WHEN $1 THEN $2::numeric ELSE 0 END,
         total_lost    = total_lost + CASE WHEN NOT $1 THEN $3::numeric ELSE 0 END
       WHERE public_key = $4`,
      [won ?? false, payoutXlm ?? "0", payoutXlm ?? "0", body.playerPublicKey]
    );

    res.json({
      outcome,
      outcomeName: outcome === 0 ? "HEADS" : "TAILS",
      won,
      payoutXlm,
      status: resolvedStatus,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /game/coinflip/config ─────────────────────────────────────────────────

coinFlipRouter.get("/config", (_req, res) => {
  res.json({
    minBetXlm: COIN_FLIP_MIN_XLM,
    maxBetXlm: COIN_FLIP_MAX_XLM,
    payoutMultiplierBps: 20_000,
    houseEdgeBps: HOUSE_EDGE_BPS,
    contractId: process.env["LUMABET_COIN_FLIP_CONTRACT_ID"] ?? null,
  });
});
