import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createServer } from "../server.js";

vi.mock("../db/client.js", () => ({
  db: { query: vi.fn() },
}));

import { db } from "../db/client.js";

const app = createServer();

// 56-char key matching the Stellar public key shape the schema validates
const VALID_KEY = `G${"A".repeat(55)}`;

const mockBet = {
  id: "bet-1",
  player_public_key: VALID_KEY,
  game_type: "DICE",
  prediction: 3,
  amount_xlm: "1.0000000",
  outcome: null,
  status: "WON",
  payout_xlm: null,
  transaction_hash: "abc123",
  created_at: new Date().toISOString(),
  resolved_at: null,
};

describe("GET /game/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with a data array and total when no filters are applied", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ count: "2" }] } as never)
      .mockResolvedValueOnce({ rows: [mockBet, mockBet] } as never);

    const res = await request(app).get("/game/history");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.total).toBe(2);
    expect(res.body.limit).toBe(20); // schema default
    expect(res.body.offset).toBe(0); // schema default
  });

  it("includes playerPublicKey in the SQL WHERE clause and params", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ count: "1" }] } as never)
      .mockResolvedValueOnce({ rows: [mockBet] } as never);

    await request(app).get(`/game/history?playerPublicKey=${VALID_KEY}`);

    const calls = vi.mocked(db.query).mock.calls;
    // Both the COUNT query and the data query should carry the WHERE clause
    expect(calls[0]![0]).toContain("player_public_key");
    expect(calls[0]![1]).toContain(VALID_KEY);
  });

  it("includes status filter in WHERE clause and returns only WON bets", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ count: "1" }] } as never)
      .mockResolvedValueOnce({ rows: [mockBet] } as never);

    const res = await request(app).get("/game/history?status=WON");

    expect(res.status).toBe(200);
    const calls = vi.mocked(db.query).mock.calls;
    expect(calls[0]![0]).toContain("status");
    expect(calls[0]![1]).toContain("WON");
    expect(res.body.data[0].status).toBe("WON");
  });

  it("passes the correct LIMIT and OFFSET when ?limit=5&offset=10", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ count: "50" }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const res = await request(app).get("/game/history?limit=5&offset=10");

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(5);
    expect(res.body.offset).toBe(10);
    // The second db.query call carries [limit, offset] appended to params
    const dataParams = vi.mocked(db.query).mock.calls[1]![1] as unknown[];
    expect(dataParams).toContain(5);
    expect(dataParams).toContain(10);
  });

  it("returns 400 Bad Request for a non-numeric limit value", async () => {
    const res = await request(app).get("/game/history?limit=abc");
    expect(res.status).toBe(400);
  });
});
