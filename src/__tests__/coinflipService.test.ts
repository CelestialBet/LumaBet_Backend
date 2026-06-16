/**
 * coinflipService.test.ts — Unit tests for processCommit / processReveal / settleReveal.
 *
 * Mocks:
 *  - ../db/client.js         (db.query)
 *  - ../services/stellarService.js (all four exported functions)
 *
 * No database or Stellar network connections are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock("../db/client.js", () => ({
  db: { query: vi.fn() },
}));

vi.mock("../services/stellarService.js", () => ({
  buildCommitTransaction: vi.fn(),
  buildRevealTransaction: vi.fn(),
  submitTransaction: vi.fn(),
  listenForContractEvent: vi.fn(),
}));

// ── Deferred imports ───────────────────────────────────────────────────────────

import { processCommit, processReveal, settleReveal } from "../services/coinflipService.js";
import { db } from "../db/client.js";
import {
  buildCommitTransaction,
  buildRevealTransaction,
  submitTransaction,
  listenForContractEvent,
} from "../services/stellarService.js";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const PLAYER = "G" + "A".repeat(54) + "B"; // 56 chars
const COMMIT_HEX = "a".repeat(64);
const SECRET_HEX = "b".repeat(64);
const BET_DB_ID = "550e8400-e29b-41d4-a716-446655440000";
const COMMIT_XDR = "unsigned-commit-xdr";
const REVEAL_XDR = "unsigned-reveal-xdr";
const SIGNED_COMMIT_XDR = "signed-commit-xdr";
const SIGNED_REVEAL_XDR = "signed-reveal-xdr";

// ── processCommit ──────────────────────────────────────────────────────────────

describe("processCommit", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(buildCommitTransaction).mockResolvedValue(COMMIT_XDR);
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{ id: BET_DB_ID }],
    });
  });

  it("returns commitXdr and betDbId on valid input", async () => {
    const result = await processCommit({
      playerAddress: PLAYER,
      commitmentHex: COMMIT_HEX,
      betAmountXlm: "1.5",
      playerChoice: 0,
    });

    expect(result).toEqual({ commitXdr: COMMIT_XDR, betDbId: BET_DB_ID });
    expect(buildCommitTransaction).toHaveBeenCalledOnce();
    expect(buildCommitTransaction).toHaveBeenCalledWith(
      PLAYER,
      Buffer.from(COMMIT_HEX, "hex"),
      15_000_000n, // 1.5 XLM in stroops
      0
    );
    expect(db.query).toHaveBeenCalledOnce();
  });

  it("throws status 400 on invalid playerAddress", async () => {
    await expect(
      processCommit({
        playerAddress: "not-a-stellar-address",
        commitmentHex: COMMIT_HEX,
        betAmountXlm: "1",
        playerChoice: 0,
      })
    ).rejects.toMatchObject({ status: 400, message: /invalid player address/i });

    expect(buildCommitTransaction).not.toHaveBeenCalled();
  });

  it("throws status 400 on invalid commitmentHex (wrong length)", async () => {
    await expect(
      processCommit({
        playerAddress: PLAYER,
        commitmentHex: "abc123", // too short
        betAmountXlm: "1",
        playerChoice: 0,
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("throws status 400 on invalid playerChoice", async () => {
    await expect(
      processCommit({
        playerAddress: PLAYER,
        commitmentHex: COMMIT_HEX,
        betAmountXlm: "1",
        playerChoice: 2, // invalid — must be 0 or 1
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("throws status 400 when bet is below minimum (0.1 XLM)", async () => {
    await expect(
      processCommit({
        playerAddress: PLAYER,
        commitmentHex: COMMIT_HEX,
        betAmountXlm: "0.09",
        playerChoice: 0,
      })
    ).rejects.toMatchObject({ status: 400, message: /minimum bet/i });
  });

  it("throws status 400 when bet exceeds maximum (500 XLM)", async () => {
    await expect(
      processCommit({
        playerAddress: PLAYER,
        commitmentHex: COMMIT_HEX,
        betAmountXlm: "501",
        playerChoice: 1,
      })
    ).rejects.toMatchObject({ status: 400, message: /maximum bet/i });
  });
});

// ── processReveal ──────────────────────────────────────────────────────────────

describe("processReveal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(submitTransaction).mockResolvedValue({
      hash: "commit-tx-hash-abc123",
      ledger: 50,
    });
    vi.mocked(buildRevealTransaction).mockResolvedValue(REVEAL_XDR);
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });
  });

  it("submits commit tx, updates DB, and returns revealXdr", async () => {
    const result = await processReveal({
      playerAddress: PLAYER,
      secretHex: SECRET_HEX,
      signedCommitXdr: SIGNED_COMMIT_XDR,
      betDbId: BET_DB_ID,
    });

    expect(result).toEqual({
      revealXdr: REVEAL_XDR,
      commitTxHash: "commit-tx-hash-abc123",
    });
    expect(submitTransaction).toHaveBeenCalledWith(SIGNED_COMMIT_XDR);
    expect(buildRevealTransaction).toHaveBeenCalledWith(
      PLAYER,
      Buffer.from(SECRET_HEX, "hex")
    );
    expect(db.query).toHaveBeenCalledOnce();
  });

  it("throws status 400 on invalid secretHex", async () => {
    await expect(
      processReveal({
        playerAddress: PLAYER,
        secretHex: "zzzz", // not hex
        signedCommitXdr: SIGNED_COMMIT_XDR,
        betDbId: BET_DB_ID,
      })
    ).rejects.toMatchObject({ status: 400 });

    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("throws status 422 when commit tx submission fails", async () => {
    vi.mocked(submitTransaction).mockRejectedValueOnce(
      new Error("Transaction rejected by Stellar")
    );

    await expect(
      processReveal({
        playerAddress: PLAYER,
        secretHex: SECRET_HEX,
        signedCommitXdr: SIGNED_COMMIT_XDR,
        betDbId: BET_DB_ID,
      })
    ).rejects.toMatchObject({ status: 422, message: /Transaction rejected/ });
  });
});

// ── settleReveal ───────────────────────────────────────────────────────────────

describe("settleReveal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });
  });

  it("extracts outcome from scvMap returnValue (no event polling needed)", async () => {
    const mockReturnValue = {
      switch: () => ({ name: "scvMap" }),
      map: () => [
        {
          key: () => ({ sym: () => ({ toString: () => "outcome" }) }),
          val: () => ({ u64: () => ({ toString: () => "0" }) }),
        },
        {
          key: () => ({ sym: () => ({ toString: () => "won" }) }),
          val: () => ({ b: () => false }),
        },
      ],
    };

    vi.mocked(submitTransaction).mockResolvedValueOnce({
      hash: "reveal-tx-hash",
      ledger: 200,
      returnValue: mockReturnValue as never,
    });

    const result = await settleReveal({
      playerAddress: PLAYER,
      signedRevealXdr: SIGNED_REVEAL_XDR,
      betDbId: BET_DB_ID,
    });

    expect(result).toMatchObject({
      outcome: 0,
      outcomeName: "HEADS",
      won: false,
      payoutStroops: null,
      revealTxHash: "reveal-tx-hash",
    });
    expect(listenForContractEvent).not.toHaveBeenCalled();
  });

  it("falls back to event polling when returnValue is null", async () => {
    vi.mocked(submitTransaction).mockResolvedValueOnce({
      hash: "reveal-tx-hash-2",
      ledger: 300,
      returnValue: null as never,
    });
    vi.mocked(listenForContractEvent).mockResolvedValueOnce({
      player: PLAYER,
      betId: 1n,
      outcome: 1,
      won: false,
    });

    const result = await settleReveal({
      playerAddress: PLAYER,
      signedRevealXdr: SIGNED_REVEAL_XDR,
      betDbId: BET_DB_ID,
    });

    expect(result).toMatchObject({
      outcome: 1,
      outcomeName: "TAILS",
      won: false,
      payoutStroops: null,
    });
    expect(listenForContractEvent).toHaveBeenCalledWith(PLAYER, 299);
  });

  it("computes payout when player won", async () => {
    const mockReturnValue = {
      switch: () => ({ name: "scvMap" }),
      map: () => [
        {
          key: () => ({ sym: () => ({ toString: () => "outcome" }) }),
          val: () => ({ u64: () => ({ toString: () => "0" }) }),
        },
        {
          key: () => ({ sym: () => ({ toString: () => "won" }) }),
          val: () => ({ b: () => true }),
        },
      ],
    };

    vi.mocked(submitTransaction).mockResolvedValueOnce({
      hash: "reveal-tx-hash-3",
      ledger: 400,
      returnValue: mockReturnValue as never,
    });
    // SELECT bet_amount runs first (inside the "if won" block), then UPDATE
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{ bet_amount: "10000000" }],
    });
    // UPDATE falls through to the beforeEach default { rows: [] }

    const result = await settleReveal({
      playerAddress: PLAYER,
      signedRevealXdr: SIGNED_REVEAL_XDR,
      betDbId: BET_DB_ID,
    });

    expect(result.won).toBe(true);
    expect(result.payoutStroops).toBe(19_600_000n); // 1 XLM × 1.96 = 1.96 XLM
    expect(result.revealTxHash).toBe("reveal-tx-hash-3");
  });

  it("throws status 422 when reveal tx submission fails", async () => {
    vi.mocked(submitTransaction).mockRejectedValueOnce(
      new Error("Insufficient fee")
    );

    await expect(
      settleReveal({
        playerAddress: PLAYER,
        signedRevealXdr: SIGNED_REVEAL_XDR,
        betDbId: BET_DB_ID,
      })
    ).rejects.toMatchObject({ status: 422, message: /Insufficient fee/ });
  });
});
