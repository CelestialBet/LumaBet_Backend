/**
 * dice.test.ts — API-level tests for /api/games/dice/*
 *
 * All Stellar SDK calls and database queries are mocked so no real
 * network connections or database connections are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// ── Module mocks (hoisted before all imports) ─────────────────────────────────

vi.mock("../services/diceService.js", () => ({
  processPlace: vi.fn(),
  processRoll: vi.fn(),
  processResolve: vi.fn(),
  processFinalize: vi.fn(),
}));

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
import { processPlace, processRoll, processResolve, processFinalize } from "../services/diceService.js";
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

const PLAYER = "G" + "A".repeat(54) + "B";
const BET_DB_ID = "550e8400-e29b-41d4-a716-446655440000";
const SIGNED_XDR = "AAAAAAAAAAAAA";

// ── POST /api/games/dice/place ────────────────────────────────────────────────

describe("POST /api/games/dice/place", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    app = buildApp();
  });

  it("valid input returns unsigned XDR and betDbId", async () => {
    vi.mocked(processPlace).mockResolvedValueOnce({
      placeXdr: "unsigned-place-xdr",
      betDbId: BET_DB_ID,
    });

    const res = await supertest(app)
      .post("/api/games/dice/place")
      .send({ playerAddress: PLAYER, amountXlm: "10", prediction: 4 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ placeXdr: "unsigned-place-xdr", betDbId: BET_DB_ID });
    expect(processPlace).toHaveBeenCalledWith(
      expect.objectContaining({ playerAddress: PLAYER, amountXlm: "10", prediction: 4 })
    );
  });

  it("prediction out of range returns 400", async () => {
    const res = await supertest(app)
      .post("/api/games/dice/place")
      .send({ playerAddress: PLAYER, amountXlm: "10", prediction: 7 });

    expect(res.status).toBe(400);
    expect(processPlace).not.toHaveBeenCalled();
  });

  it("bet below 1 XLM minimum returns 400", async () => {
    const res = await supertest(app)
      .post("/api/games/dice/place")
      .send({ playerAddress: PLAYER, amountXlm: "0.5", prediction: 4 });

    expect(res.status).toBe(400);
    expect(processPlace).not.toHaveBeenCalled();
  });
});

// ── POST /api/games/dice/roll ──────────────────────────────────────────────────

describe("POST /api/games/dice/roll", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    app = buildApp();
  });

  it("valid roll submits place tx and returns roll XDR", async () => {
    vi.mocked(processRoll).mockResolvedValueOnce({
      rollXdr: "unsigned-roll-xdr",
      onChainBetId: "3",
      placeTxHash: "place-tx-hash",
    });

    const res = await supertest(app)
      .post("/api/games/dice/roll")
      .send({ playerAddress: PLAYER, betDbId: BET_DB_ID, signedPlaceXdr: SIGNED_XDR });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rollXdr: "unsigned-roll-xdr", onChainBetId: "3" });
    expect(processRoll).toHaveBeenCalledOnce();
  });

  it("service error propagates as 422", async () => {
    const err = Object.assign(new Error("place_bet transaction failed"), { status: 422 });
    vi.mocked(processRoll).mockRejectedValueOnce(err);

    const res = await supertest(app)
      .post("/api/games/dice/roll")
      .send({ playerAddress: PLAYER, betDbId: BET_DB_ID, signedPlaceXdr: SIGNED_XDR });

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty("error");
  });
});

// ── POST /api/games/dice/resolve ───────────────────────────────────────────────

describe("POST /api/games/dice/resolve", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    app = buildApp();
  });

  it("valid resolve returns outcome and unsigned finalize XDR", async () => {
    vi.mocked(processResolve).mockResolvedValueOnce({
      resolveXdr: "unsigned-claim-xdr",
      outcome: 4,
      won: true,
      rollTxHash: "roll-tx-hash",
    });

    const res = await supertest(app)
      .post("/api/games/dice/resolve")
      .send({ playerAddress: PLAYER, betDbId: BET_DB_ID, signedRollXdr: SIGNED_XDR });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ resolveXdr: "unsigned-claim-xdr", outcome: 4, won: true });
  });
});

// ── POST /api/games/dice/finalize ──────────────────────────────────────────────

describe("POST /api/games/dice/finalize", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    app = buildApp();
  });

  it("valid finalize returns won result with payout", async () => {
    vi.mocked(processFinalize).mockResolvedValueOnce({
      outcome: 4,
      won: true,
      payoutStroops: 49_000_000n,
      status: "won",
      resolveTxHash: "resolve-tx-hash",
    });

    const res = await supertest(app)
      .post("/api/games/dice/finalize")
      .send({ playerAddress: PLAYER, betDbId: BET_DB_ID, signedResolveXdr: SIGNED_XDR });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 4, won: true, status: "won", payoutStroops: "49000000" });
  });
});

// ── GET /api/games/dice/status/:address ────────────────────────────────────────

describe("GET /api/games/dice/status/:address", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    app = buildApp();
  });

  it("returns the most recent bet for the address", async () => {
    const mockBet = {
      id: BET_DB_ID,
      player_address: PLAYER,
      game_type: "DICE",
      bet_amount: "100000000",
      prediction: 4,
      outcome: null,
      status: "placed",
      created_at: new Date().toISOString(),
    };
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [mockBet] });

    const res = await supertest(app).get(`/api/games/dice/status/${PLAYER}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: BET_DB_ID, status: "placed" });
  });

  it("invalid address returns 400", async () => {
    const res = await supertest(app).get("/api/games/dice/status/not-a-valid-address");

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });
});

// ── GET /api/games/dice/history ────────────────────────────────────────────────

describe("GET /api/games/dice/history", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    app = buildApp();
  });

  it("returns paginated bet history for a player address", async () => {
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ count: "2" }] })
      .mockResolvedValueOnce({
        rows: [
          { id: "id-1", status: "won", bet_amount: "10000000" },
          { id: "id-2", status: "lost", bet_amount: "5000000" },
        ],
      });

    const res = await supertest(app).get(`/api/games/dice/history?playerAddress=${PLAYER}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, limit: 20, offset: 0 });
    expect(res.body.data).toHaveLength(2);
  });
});
