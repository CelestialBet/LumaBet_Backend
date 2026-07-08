/**
 * diceService.test.ts — Unit tests for processPlace / processRoll / processResolve / processFinalize.
 *
 * Mocks:
 *  - ../db/client.js                (db.query)
 *  - ../services/diceStellarService.js (all exported functions)
 *
 * No database or Stellar network connections are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock("../db/client.js", () => ({
  db: { query: vi.fn() },
}));

vi.mock("../services/diceStellarService.js", () => ({
  buildPlaceBetTransaction: vi.fn(),
  buildRollDiceTransaction: vi.fn(),
  buildClaimWinningsTransaction: vi.fn(),
  buildResolveLostBetTransaction: vi.fn(),
  submitTransaction: vi.fn(),
  parseBetId: vi.fn(),
  parseDiceRoll: vi.fn(),
}));

// ── Deferred imports ───────────────────────────────────────────────────────────

import { processPlace, processRoll, processResolve, processFinalize } from "../services/diceService.js";
import { db } from "../db/client.js";
import {
  buildPlaceBetTransaction,
  buildRollDiceTransaction,
  buildClaimWinningsTransaction,
  buildResolveLostBetTransaction,
  submitTransaction,
  parseBetId,
  parseDiceRoll,
} from "../services/diceStellarService.js";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const PLAYER = "G" + "A".repeat(54) + "B"; // 56 chars
const BET_DB_ID = "550e8400-e29b-41d4-a716-446655440000";
const PLACE_XDR = "unsigned-place-xdr";
const ROLL_XDR = "unsigned-roll-xdr";
const CLAIM_XDR = "unsigned-claim-xdr";
const LOST_XDR = "unsigned-resolve-lost-xdr";
const SIGNED_PLACE_XDR = "signed-place-xdr";
const SIGNED_ROLL_XDR = "signed-roll-xdr";
const SIGNED_RESOLVE_XDR = "signed-resolve-xdr";

// ── processPlace ─────────────────────────────────────────────────────────────

describe("processPlace", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(buildPlaceBetTransaction).mockResolvedValue(PLACE_XDR);
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [{ id: BET_DB_ID }] });
  });

  it("returns placeXdr and betDbId on valid input", async () => {
    const result = await processPlace({ playerAddress: PLAYER, amountXlm: "10", prediction: 4 });

    expect(result).toEqual({ placeXdr: PLACE_XDR, betDbId: BET_DB_ID });
    expect(buildPlaceBetTransaction).toHaveBeenCalledWith(PLAYER, 100_000_000n, 4);
  });

  it("throws status 400 on invalid playerAddress", async () => {
    await expect(
      processPlace({ playerAddress: "not-a-stellar-address", amountXlm: "10", prediction: 4 })
    ).rejects.toMatchObject({ status: 400, message: /invalid player address/i });

    expect(buildPlaceBetTransaction).not.toHaveBeenCalled();
  });

  it("throws status 400 on prediction out of range", async () => {
    await expect(
      processPlace({ playerAddress: PLAYER, amountXlm: "10", prediction: 7 })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("throws status 400 when bet is below minimum (1 XLM)", async () => {
    await expect(
      processPlace({ playerAddress: PLAYER, amountXlm: "0.5", prediction: 4 })
    ).rejects.toMatchObject({ status: 400, message: /minimum bet/i });
  });

  it("throws status 400 when bet exceeds maximum (1000 XLM)", async () => {
    await expect(
      processPlace({ playerAddress: PLAYER, amountXlm: "1001", prediction: 4 })
    ).rejects.toMatchObject({ status: 400, message: /maximum bet/i });
  });
});

// ── processRoll ──────────────────────────────────────────────────────────────

describe("processRoll", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ prediction: 4, on_chain_bet_id: null, bet_amount: "100000000" }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE
    vi.mocked(submitTransaction).mockResolvedValue({ hash: "place-tx-hash", ledger: 100 });
    vi.mocked(parseBetId).mockReturnValue(3n);
    vi.mocked(buildRollDiceTransaction).mockResolvedValue(ROLL_XDR);
  });

  it("submits place tx, updates DB, and returns rollXdr", async () => {
    const result = await processRoll({
      playerAddress: PLAYER,
      betDbId: BET_DB_ID,
      signedPlaceXdr: SIGNED_PLACE_XDR,
    });

    expect(result).toEqual({ rollXdr: ROLL_XDR, onChainBetId: "3", placeTxHash: "place-tx-hash" });
    expect(submitTransaction).toHaveBeenCalledWith(SIGNED_PLACE_XDR);
    expect(buildRollDiceTransaction).toHaveBeenCalledWith(PLAYER, 3n, 4, expect.any(BigInt));
  });

  it("throws status 404 when bet is not found", async () => {
    vi.resetAllMocks();
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

    await expect(
      processRoll({ playerAddress: PLAYER, betDbId: BET_DB_ID, signedPlaceXdr: SIGNED_PLACE_XDR })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("throws status 422 when place tx submission fails", async () => {
    vi.mocked(submitTransaction).mockRejectedValueOnce(new Error("Transaction rejected"));

    await expect(
      processRoll({ playerAddress: PLAYER, betDbId: BET_DB_ID, signedPlaceXdr: SIGNED_PLACE_XDR })
    ).rejects.toMatchObject({ status: 422, message: /Transaction rejected/ });
  });

  it("throws status 422 when bet_id cannot be parsed", async () => {
    vi.mocked(parseBetId).mockReturnValueOnce(null);

    await expect(
      processRoll({ playerAddress: PLAYER, betDbId: BET_DB_ID, signedPlaceXdr: SIGNED_PLACE_XDR })
    ).rejects.toMatchObject({ status: 422 });
  });
});

// ── processResolve ───────────────────────────────────────────────────────────

describe("processResolve", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ prediction: 4, on_chain_bet_id: "3", bet_amount: "100000000" }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE
    vi.mocked(submitTransaction).mockResolvedValue({ hash: "roll-tx-hash", ledger: 200 });
  });

  it("builds claim_winnings XDR when won", async () => {
    vi.mocked(parseDiceRoll).mockReturnValue({ outcome: 4, won: true });
    vi.mocked(buildClaimWinningsTransaction).mockResolvedValue(CLAIM_XDR);

    const result = await processResolve({
      playerAddress: PLAYER,
      betDbId: BET_DB_ID,
      signedRollXdr: SIGNED_ROLL_XDR,
    });

    expect(result).toEqual({
      resolveXdr: CLAIM_XDR,
      outcome: 4,
      won: true,
      rollTxHash: "roll-tx-hash",
    });
    expect(buildClaimWinningsTransaction).toHaveBeenCalledWith(PLAYER, 3n);
    expect(buildResolveLostBetTransaction).not.toHaveBeenCalled();
  });

  it("builds resolve_lost_bet XDR when lost", async () => {
    vi.mocked(parseDiceRoll).mockReturnValue({ outcome: 2, won: false });
    vi.mocked(buildResolveLostBetTransaction).mockResolvedValue(LOST_XDR);

    const result = await processResolve({
      playerAddress: PLAYER,
      betDbId: BET_DB_ID,
      signedRollXdr: SIGNED_ROLL_XDR,
    });

    expect(result.resolveXdr).toBe(LOST_XDR);
    expect(result.won).toBe(false);
    expect(buildClaimWinningsTransaction).not.toHaveBeenCalled();
  });

  it("throws status 404 when bet has not been placed", async () => {
    vi.resetAllMocks();
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

    await expect(
      processResolve({ playerAddress: PLAYER, betDbId: BET_DB_ID, signedRollXdr: SIGNED_ROLL_XDR })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("throws status 422 when roll cannot be parsed", async () => {
    vi.mocked(parseDiceRoll).mockReturnValue(null);

    await expect(
      processResolve({ playerAddress: PLAYER, betDbId: BET_DB_ID, signedRollXdr: SIGNED_ROLL_XDR })
    ).rejects.toMatchObject({ status: 422 });
  });
});

// ── processFinalize ──────────────────────────────────────────────────────────

describe("processFinalize", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(submitTransaction).mockResolvedValue({ hash: "resolve-tx-hash", ledger: 300 });
  });

  it("computes payout and marks won", async () => {
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ outcome: 4, won: true, bet_amount: "100000000" }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const result = await processFinalize({
      playerAddress: PLAYER,
      betDbId: BET_DB_ID,
      signedResolveXdr: SIGNED_RESOLVE_XDR,
    });

    expect(result.status).toBe("won");
    expect(result.payoutStroops).toBe(490_000_000n); // 10 XLM * 5x * 0.98
    expect(result.resolveTxHash).toBe("resolve-tx-hash");
  });

  it("returns null payout when lost", async () => {
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ outcome: 2, won: false, bet_amount: "100000000" }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await processFinalize({
      playerAddress: PLAYER,
      betDbId: BET_DB_ID,
      signedResolveXdr: SIGNED_RESOLVE_XDR,
    });

    expect(result.status).toBe("lost");
    expect(result.payoutStroops).toBeNull();
  });

  it("throws status 404 when bet has not been rolled", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

    await expect(
      processFinalize({ playerAddress: PLAYER, betDbId: BET_DB_ID, signedResolveXdr: SIGNED_RESOLVE_XDR })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("throws status 422 when resolve tx submission fails", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{ outcome: 4, won: true, bet_amount: "100000000" }],
    });
    vi.mocked(submitTransaction).mockRejectedValueOnce(new Error("Insufficient fee"));

    await expect(
      processFinalize({ playerAddress: PLAYER, betDbId: BET_DB_ID, signedResolveXdr: SIGNED_RESOLVE_XDR })
    ).rejects.toMatchObject({ status: 422, message: /Insufficient fee/ });
  });
});
