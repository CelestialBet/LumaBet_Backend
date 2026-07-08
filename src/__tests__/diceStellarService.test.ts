/**
 * diceStellarService.test.ts — Unit tests for the diceStellarService layer.
 *
 * Mocks:
 *  - ../lib/stellar-client/soroban.js: buildContractCall + submitAndWait
 *
 * No real network calls are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/stellar-client/soroban.js", () => ({
  buildContractCall: vi.fn(),
  submitAndWait: vi.fn(),
}));

import {
  buildPlaceBetTransaction,
  buildRollDiceTransaction,
  buildClaimWinningsTransaction,
  buildResolveLostBetTransaction,
  submitTransaction,
  parseBetId,
  parseDiceRoll,
  type SubmitResult,
} from "../services/diceStellarService.js";
import { buildContractCall, submitAndWait } from "../lib/stellar-client/soroban.js";

const PLAYER = "G" + "A".repeat(54) + "B"; // 56 chars
const FAKE_XDR = "AAABBBCCC_signed_xdr";

describe("buildPlaceBetTransaction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (buildContractCall as ReturnType<typeof vi.fn>).mockResolvedValue("place-xdr-string");
  });

  it("calls core.place_bet with a DICE symbol and returns the XDR", async () => {
    const xdr = await buildPlaceBetTransaction(PLAYER, 100_000_000n, 4);

    expect(xdr).toBe("place-xdr-string");
    expect(buildContractCall).toHaveBeenCalledWith(
      PLAYER,
      expect.any(String),
      "place_bet",
      expect.arrayContaining([
        expect.objectContaining({ type: "address", value: PLAYER }),
        expect.objectContaining({ type: "i128", value: 100_000_000n }),
        expect.objectContaining({ type: "symbol", value: "DICE" }),
        expect.objectContaining({ type: "u64", value: 4n }),
      ]),
      "testnet"
    );
  });
});

describe("buildRollDiceTransaction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (buildContractCall as ReturnType<typeof vi.fn>).mockResolvedValue("roll-xdr-string");
  });

  it("calls dice.roll_dice with bet_id, prediction, and seed", async () => {
    const xdr = await buildRollDiceTransaction(PLAYER, 3n, 4, 12345n);

    expect(xdr).toBe("roll-xdr-string");
    expect(buildContractCall).toHaveBeenCalledWith(
      PLAYER,
      expect.any(String),
      "roll_dice",
      expect.arrayContaining([
        expect.objectContaining({ type: "address", value: PLAYER }),
        expect.objectContaining({ type: "u64", value: 3n }),
        expect.objectContaining({ type: "u64", value: 4n }),
        expect.objectContaining({ type: "u64", value: 12345n }),
      ]),
      "testnet"
    );
  });
});

describe("buildClaimWinningsTransaction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (buildContractCall as ReturnType<typeof vi.fn>).mockResolvedValue("claim-xdr-string");
  });

  it("calls dice.claim_winnings with player and bet_id", async () => {
    const xdr = await buildClaimWinningsTransaction(PLAYER, 3n);

    expect(xdr).toBe("claim-xdr-string");
    expect(buildContractCall).toHaveBeenCalledWith(
      PLAYER,
      expect.any(String),
      "claim_winnings",
      expect.arrayContaining([
        expect.objectContaining({ type: "address", value: PLAYER }),
        expect.objectContaining({ type: "u64", value: 3n }),
      ]),
      "testnet"
    );
  });
});

describe("buildResolveLostBetTransaction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (buildContractCall as ReturnType<typeof vi.fn>).mockResolvedValue("resolve-lost-xdr-string");
  });

  it("calls dice.resolve_lost_bet with player and bet_id", async () => {
    const xdr = await buildResolveLostBetTransaction(PLAYER, 3n);

    expect(xdr).toBe("resolve-lost-xdr-string");
    expect(buildContractCall).toHaveBeenCalledWith(
      PLAYER,
      expect.any(String),
      "resolve_lost_bet",
      expect.arrayContaining([
        expect.objectContaining({ type: "address", value: PLAYER }),
        expect.objectContaining({ type: "u64", value: 3n }),
      ]),
      "testnet"
    );
  });
});

describe("submitTransaction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("delegates to submitAndWait and returns hash and ledger", async () => {
    const mockResult = { hash: "abc123", ledger: 12_345 };
    (submitAndWait as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResult);

    const result = await submitTransaction(FAKE_XDR);

    expect(result).toEqual(mockResult);
    expect(submitAndWait).toHaveBeenCalledWith(FAKE_XDR, "testnet");
  });

  it("propagates errors from the RPC", async () => {
    (submitAndWait as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Transaction rejected: insufficient balance")
    );

    await expect(submitTransaction(FAKE_XDR)).rejects.toThrow("Transaction rejected");
  });
});

describe("parseBetId", () => {
  it("parses a scvU64 return value", () => {
    const result: SubmitResult = {
      hash: "h",
      ledger: 1,
      returnValue: {
        switch: () => ({ name: "scvU64" }),
        u64: () => ({ toString: () => "3" }),
      } as never,
    };

    expect(parseBetId(result)).toBe(3n);
  });

  it("returns null when returnValue is missing", () => {
    expect(parseBetId({ hash: "h", ledger: 1 })).toBeNull();
  });

  it("returns null when returnValue is not a scvU64", () => {
    const result: SubmitResult = {
      hash: "h",
      ledger: 1,
      returnValue: { switch: () => ({ name: "scvMap" }) } as never,
    };

    expect(parseBetId(result)).toBeNull();
  });
});

describe("parseDiceRoll", () => {
  it("parses outcome and won from a scvMap return value", () => {
    const result: SubmitResult = {
      hash: "h",
      ledger: 1,
      returnValue: {
        switch: () => ({ name: "scvMap" }),
        map: () => [
          {
            key: () => ({ sym: () => ({ toString: () => "outcome" }) }),
            val: () => ({ u64: () => ({ toString: () => "4" }) }),
          },
          {
            key: () => ({ sym: () => ({ toString: () => "won" }) }),
            val: () => ({ switch: () => ({ name: "scvBool" }), b: () => true }),
          },
        ],
      } as never,
    };

    expect(parseDiceRoll(result)).toEqual({ outcome: 4, won: true });
  });

  it("returns null when returnValue is not a scvMap", () => {
    const result: SubmitResult = {
      hash: "h",
      ledger: 1,
      returnValue: { switch: () => ({ name: "scvU64" }) } as never,
    };

    expect(parseDiceRoll(result)).toBeNull();
  });

  it("returns null when outcome/won keys are absent", () => {
    const result: SubmitResult = {
      hash: "h",
      ledger: 1,
      returnValue: {
        switch: () => ({ name: "scvMap" }),
        map: () => [],
      } as never,
    };

    expect(parseDiceRoll(result)).toBeNull();
  });
});
