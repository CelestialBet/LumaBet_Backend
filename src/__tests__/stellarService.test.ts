/**
 * stellarService.test.ts — Unit tests for the stellarService layer.
 *
 * Mocks:
 *  - @stellar/stellar-sdk: SorobanRpc.Server (for listenForContractEvent)
 *  - ../lib/stellar-client/soroban.js: buildContractCall + submitAndWait
 *
 * No real network calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mock references (available inside vi.mock factories) ───────────────

const mockGetEvents = vi.hoisted(() => vi.fn().mockResolvedValue({ events: [] }));
// Named ref so we can re-apply mockImplementation after vi.resetAllMocks()
const MockServer = vi.hoisted(() => vi.fn());

// ── Mock @stellar/stellar-sdk — provide only what stellarService.ts uses ───────

vi.mock("@stellar/stellar-sdk", () => ({
  SorobanRpc: {
    Server: MockServer,
    Api: {},
  },
  xdr: {
    Uint64: {
      fromString: vi.fn().mockReturnValue({ toString: () => "0" }),
    },
  },
}));

// ── Mock low-level soroban helpers ─────────────────────────────────────────────

vi.mock("../lib/stellar-client/soroban.js", () => ({
  buildContractCall: vi.fn(),
  submitAndWait: vi.fn(),
}));

// ── Deferred imports (after mocks are installed) ───────────────────────────────

import {
  buildCommitTransaction,
  buildRevealTransaction,
  submitTransaction,
  listenForContractEvent,
} from "../services/stellarService.js";
import {
  buildContractCall,
  submitAndWait,
} from "../lib/stellar-client/soroban.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PLAYER = "G" + "A".repeat(54) + "B"; // 56 chars
const FAKE_XDR = "AAABBBCCC_signed_xdr";
const FAKE_COMMITMENT = Buffer.from("a".repeat(64), "hex");
const FAKE_SECRET = Buffer.from("b".repeat(64), "hex");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildCommitTransaction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (buildContractCall as ReturnType<typeof vi.fn>).mockResolvedValue(
      "commit-xdr-string"
    );
  });

  // 1. Returns valid XDR string
  it("returns the XDR string from buildContractCall", async () => {
    const xdr = await buildCommitTransaction(
      PLAYER,
      FAKE_COMMITMENT,
      10_000_000n,
      0
    );

    expect(xdr).toBe("commit-xdr-string");
    expect(buildContractCall).toHaveBeenCalledOnce();
    expect(buildContractCall).toHaveBeenCalledWith(
      PLAYER,
      expect.any(String), // contract ID from env
      "commit_bet",
      expect.arrayContaining([
        expect.objectContaining({ type: "address", value: PLAYER }),
        expect.objectContaining({ type: "bytes" }),
        expect.objectContaining({ type: "i128", value: 10_000_000n }),
        expect.objectContaining({ type: "u64", value: 0n }),
      ]),
      "testnet"
    );
  });
});

describe("buildRevealTransaction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (buildContractCall as ReturnType<typeof vi.fn>).mockResolvedValue(
      "reveal-xdr-string"
    );
  });

  // 2. Returns valid XDR string
  it("returns the XDR string from buildContractCall", async () => {
    const xdr = await buildRevealTransaction(PLAYER, FAKE_SECRET);

    expect(xdr).toBe("reveal-xdr-string");
    expect(buildContractCall).toHaveBeenCalledOnce();
    expect(buildContractCall).toHaveBeenCalledWith(
      PLAYER,
      expect.any(String),
      "reveal_bet",
      expect.arrayContaining([
        expect.objectContaining({ type: "address", value: PLAYER }),
        expect.objectContaining({ type: "bytes" }),
      ]),
      "testnet"
    );
  });
});

describe("submitTransaction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // 3. Delegates to submitAndWait and returns hash + ledger
  it("calls Horizon submit endpoint and returns hash and ledger", async () => {
    const mockResult = {
      hash: "abc1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
      ledger: 12_345,
    };
    (submitAndWait as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResult
    );

    const result = await submitTransaction(FAKE_XDR);

    expect(result).toEqual(mockResult);
    expect(submitAndWait).toHaveBeenCalledWith(FAKE_XDR, "testnet");
  });

  it("propagates errors from the RPC", async () => {
    (submitAndWait as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Transaction rejected: insufficient balance")
    );

    await expect(submitTransaction(FAKE_XDR)).rejects.toThrow(
      "Transaction rejected"
    );
  });
});

describe("listenForContractEvent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // vi.resetAllMocks() wipes MockServer's implementation — restore it
    MockServer.mockImplementation(() => ({ getEvents: mockGetEvents }));
    mockGetEvents.mockResolvedValue({ events: [] });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 4. Returns null when no matching event is found within the timeout
  it("resolves with null when no event is detected before the timeout", async () => {
    // Use a 100ms timeout — fake timers advance past it
    const promise = listenForContractEvent(PLAYER, 1000, 100);

    // Advance fake clock past the 2-second polling sleep and the 100ms timeout
    await vi.advanceTimersByTimeAsync(2_200);

    const result = await promise;

    expect(result).toBeNull();
    expect(mockGetEvents).toHaveBeenCalled();
    expect(mockGetEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        startLedger: 1000,
        filters: expect.arrayContaining([
          expect.objectContaining({ type: "contract" }),
        ]),
      })
    );
  });
});
