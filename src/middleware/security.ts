/**
 * security.ts — Consolidated security middleware for LumaBet API.
 *
 * Exports:
 *   globalLimiter    — 100 req / 15 min per IP (applied globally in server.ts)
 *   commitLimiter    — 5 bet commits / 60 s per IP (applied to POST /coinflip/commit)
 *   validateCommit   — express-validator chain for commit body
 *   validateReveal   — express-validator chain for reveal body
 *   handleValidationErrors — converts validation failures to 400 JSON
 *   validateEnv      — throws on missing required env vars at startup
 */

import rateLimit from "express-rate-limit";
import { body, validationResult } from "express-validator";
import type { Request, Response, NextFunction } from "express";

// ── Rate limiters ─────────────────────────────────────────────────────────────

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

export const commitLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bet rate limit exceeded, please wait before placing another bet" },
});

// ── Input validation chains ───────────────────────────────────────────────────

export const validateCommit = [
  body("playerAddress")
    .isLength({ min: 56, max: 56 })
    .matches(/^G[A-Z2-7]{55}$/)
    .withMessage("Invalid Stellar public key — must be a 56-char G-address"),

  body("commitmentHex")
    .isLength({ min: 64, max: 64 })
    .isHexadecimal()
    .withMessage("commitment must be 32 bytes encoded as 64 hex chars"),

  body("betAmountXlm")
    .isString()
    .matches(/^\d+(\.\d{1,7})?$/)
    .withMessage("betAmountXlm must be a decimal number")
    .custom((v: string) => {
      const f = parseFloat(v);
      if (isNaN(f)) throw new Error("betAmountXlm is not a number");
      if (f < 0.1) throw new Error("Minimum bet is 0.1 XLM");
      if (f > 500) throw new Error("Maximum bet is 500 XLM");
      return true;
    }),

  body("playerChoice")
    .isInt({ min: 0, max: 1 })
    .withMessage("playerChoice must be 0 (heads) or 1 (tails)"),
];

export const validateReveal = [
  body("playerAddress")
    .isLength({ min: 56, max: 56 })
    .matches(/^G[A-Z2-7]{55}$/)
    .withMessage("Invalid Stellar public key"),

  body("secretHex")
    .isLength({ min: 64, max: 64 })
    .isHexadecimal()
    .withMessage("secret must be 32 bytes encoded as 64 hex chars"),

  body("signedCommitXdr")
    .isString()
    .notEmpty()
    .withMessage("signedCommitXdr is required"),

  body("betDbId")
    .isUUID()
    .withMessage("betDbId must be a valid UUID"),
];

// ── Validation result handler ─────────────────────────────────────────────────

export function handleValidationErrors(req: Request, res: Response, next: NextFunction): void {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    res.status(400).json({
      error: "Validation failed",
      details: result.array().map((e) => ({
        field: "path" in e ? String(e.path) : "unknown",
        message: e.msg,
      })),
    });
    return;
  }
  next();
}

// ── Startup environment validation ────────────────────────────────────────────

const REQUIRED_ENV_VARS = [
  "DATABASE_URL",
  "LUMABET_COIN_FLIP_CONTRACT_ID",
  "STELLAR_NETWORK",
  "JWT_SECRET",
] as const;

export function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}
