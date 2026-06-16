/**
 * coinflip.test.ts — API-level tests for /api/games/coinflip/*
 *
 * All Stellar SDK calls and database queries are mocked so no real
 * network connections or database connections are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// ── Module mocks (hoisted before all imports) ─────────────────────────────────

vi.mock("../services/coinflipService.js", () => ({
  processCommit: vi.fn(),
  processReveal: vi.fn(),
  settleReveal: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  db: { query: vi.fn() },
}));

// ── Deferred imports (get mock versions because vi.mock runs first) ───────────

import { apiRouter } from "../routes/api.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { processCommit, processReveal, settleReveal } from "../services/coinflipService.js";
import { db } from "../db/client.js";

// ── Shared test app ───────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/games", apiRouter);
  app.use(errorHandler);
  return app;
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

// 56-char Stellar address (G + 54 A's + B = 56 total)
const PLAYER = "G" + "A".repeat(54) + "B";
// 64-char hex strings (32 bytes each)
const COMMIT_HEX = "a".repeat(64);
const SECRET_HEX = "b".repeat(64);
const SIGNED_XDR = "AAAAAAAAAAAAA"; // non-empty placeholder
const BET_DB_ID = "550e8400-e29b-41d4-a716-446655440000";

// ── POST /api/games/coinflip/commit ──────────────────────────────────────────

describe("POST /api/games/coinflip/commit", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    app = buildApp();
  });

  // 1. Valid input returns unsigned XDR transaction
  it("valid input returns unsigned XDR and betDbId", async () => {
    vi.mocked(processCommit).mockResolvedValueOnce({
      commitXdr: "AAABBBCCC...unsigned-xdr",
      betDbId: BET_DB_ID,
    });

    const res = await supertest(app)
      .post("/api/games/coinflip/commit")
      .send({
        playerAddress: PLAYER,
        commitmentHex: COMMIT_HEX,
        betAmountXlm: "1.5",
        playerChoice: 0,
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      commitXdr: "AAABBBCCC...unsigned-xdr",
      betDbId: BET_DB_ID,
    });
    expect(processCommit).toHaveBeenCalledOnce();
    expect(processCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        playerAddress: PLAYER,
        betAmountXlm: "1.5",
        playerChoice: 0,
      })
    );
  });

  // 2. Missing playerAddress returns 400
  it("missing playerAddress returns 400", async () => {
    const res = await supertest(app)
      .post("/api/games/coinflip/commit")
      .send({
        commitmentHex: COMMIT_HEX,
        betAmountXlm: "1",
        playerChoice: 0,
        // playerAddress intentionally omitted
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "Validation failed");
    expect(processCommit).not.toHaveBeenCalled();
  });

  // 3. Invalid bet amount returns 400
  it("non-numeric bet amount returns 400", async () => {
    const res = await supertest(app)
      .post("/api/games/coinflip/commit")
      .send({
        playerAddress: PLAYER,
        commitmentHex: COMMIT_HEX,
        betAmountXlm: "not-a-number",
        playerChoice: 0,
      });

    expect(res.status).toBe(400);
    expect(processCommit).not.toHaveBeenCalled();
  });

  // 4. Bet amount below minimum returns 400
  it("bet below 0.1 XLM minimum returns 400", async () => {
    const res = await supertest(app)
      .post("/api/games/coinflip/commit")
      .send({
        playerAddress: PLAYER,
        commitmentHex: COMMIT_HEX,
        betAmountXlm: "0.05",
        playerChoice: 0,
      });

    expect(res.status).toBe(400);
    expect(processCommit).not.toHaveBeenCalled();
  });
});

// ── POST /api/games/coinflip/reveal ──────────────────────────────────────────

describe("POST /api/games/coinflip/reveal", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    app = buildApp();
  });

  // 5. Valid reveal submits to Horizon and returns the reveal XDR
  it("valid reveal submits commit tx and returns reveal XDR", async () => {
    vi.mocked(processReveal).mockResolvedValueOnce({
      revealXdr: "reveal-xdr-for-freighter",
      commitTxHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    });

    const res = await supertest(app)
      .post("/api/games/coinflip/reveal")
      .send({
        playerAddress: PLAYER,
        secretHex: SECRET_HEX,
        signedCommitXdr: SIGNED_XDR,
        betDbId: BET_DB_ID,
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      revealXdr: "reveal-xdr-for-freighter",
    });
    expect(processReveal).toHaveBeenCalledOnce();
  });

  // 6. Wrong secret returns error
  it("wrong secret propagates as 422 error", async () => {
    const err = Object.assign(
      new Error("commitment verification failed — wrong secret"),
      { status: 422 }
    );
    vi.mocked(processReveal).mockRejectedValueOnce(err);

    const res = await supertest(app)
      .post("/api/games/coinflip/reveal")
      .send({
        playerAddress: PLAYER,
        secretHex: SECRET_HEX,
        signedCommitXdr: SIGNED_XDR,
        betDbId: BET_DB_ID,
      });

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty("error");
  });
});

// ── GET /api/games/coinflip/status/:address ───────────────────────────────────

describe("GET /api/games/coinflip/status/:address", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    app = buildApp();
  });

  // 7. Returns correct bet state for a player address
  it("returns the most recent bet for the address", async () => {
    const mockBet = {
      id: BET_DB_ID,
      player_address: PLAYER,
      game_type: "COIN_FLIP",
      bet_amount: "10000000",
      player_choice: 0,
      outcome: null,
      status: "committed",
      commit_tx_hash: "abc123",
      created_at: new Date().toISOString(),
    };
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [mockBet],
    });

    const res = await supertest(app).get(
      `/api/games/coinflip/status/${PLAYER}`
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: BET_DB_ID,
      status: "committed",
      player_address: PLAYER,
    });
  });
});

// ── GET /api/games/coinflip/history ──────────────────────────────────────────

describe("GET /api/games/coinflip/history", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    app = buildApp();
  });

  // 8. Returns paginated bet history
  it("returns paginated bet history for a player address", async () => {
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ count: "2" }] })
      .mockResolvedValueOnce({
        rows: [
          { id: "id-1", status: "won", bet_amount: "10000000" },
          { id: "id-2", status: "lost", bet_amount: "5000000" },
        ],
      });

    const res = await supertest(app)
      .get(`/api/games/coinflip/history?playerAddress=${PLAYER}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      total: 2,
      limit: 20,
      offset: 0,
    });
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({ id: "id-1" });
  });
});

// ── POST /api/games/coinflip/cancel ──────────────────────────────────────────

describe("POST /api/games/coinflip/cancel", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    app = buildApp();
  });

  // 9. Cancel before timeout returns 403
  it("cancel before the 10-minute timeout returns 403", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [
        {
          status: "committed",
          created_at: new Date().toISOString(), // just created — not timed out yet
        },
      ],
    });

    const res = await supertest(app)
      .post("/api/games/coinflip/cancel")
      .send({ playerAddress: PLAYER, betDbId: BET_DB_ID });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/cannot cancel yet/i);
  });

  // 10. Cancel after timeout returns success
  it("cancel after the 10-minute timeout succeeds", async () => {
    const fifteenMinsAgo = new Date(
      Date.now() - 15 * 60 * 1000
    ).toISOString();

    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        rows: [{ status: "committed", created_at: fifteenMinsAgo }],
      })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE response

    const res = await supertest(app)
      .post("/api/games/coinflip/cancel")
      .send({ playerAddress: PLAYER, betDbId: BET_DB_ID });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "cancelled",
      betDbId: BET_DB_ID,
    });
  });
});

// ── POST /api/games/coinflip/settle ──────────────────────────────────────────

describe("POST /api/games/coinflip/settle", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    app = buildApp();
  });

  // 11. Valid settle returns outcome result
  it("valid settle returns outcome and payout", async () => {
    vi.mocked(settleReveal).mockResolvedValueOnce({
      outcome: 0,
      outcomeName: "HEADS",
      won: true,
      payoutStroops: 19_600_000n,
      revealTxHash: "reveal-tx-hash-abc",
    });

    const res = await supertest(app)
      .post("/api/games/coinflip/settle")
      .send({
        playerAddress: PLAYER,
        signedRevealXdr: SIGNED_XDR,
        betDbId: BET_DB_ID,
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      outcome: 0,
      outcomeName: "HEADS",
      won: true,
    });
    expect(settleReveal).toHaveBeenCalledOnce();
  });

  // 12. Settle service error propagates as 422
  it("settle service error propagates as 422", async () => {
    const err = Object.assign(new Error("Reveal transaction timed out"), { status: 422 });
    vi.mocked(settleReveal).mockRejectedValueOnce(err);

    const res = await supertest(app)
      .post("/api/games/coinflip/settle")
      .send({
        playerAddress: PLAYER,
        signedRevealXdr: SIGNED_XDR,
        betDbId: BET_DB_ID,
      });

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty("error");
  });
});
