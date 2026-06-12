import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createServer } from "../server.js";

vi.mock("../db/client.js", () => ({
  db: { query: vi.fn() },
}));

import { db } from "../db/client.js";

const app = createServer();

const VALID_KEY = `G${"A".repeat(55)}`;

const mockPlayer = {
  public_key: VALID_KEY,
  username: null,
  total_bets: 0,
  total_won: "0.0000000",
  total_lost: "0.0000000",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("POST /player/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with the player record on a valid body", async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockPlayer] } as never);

    const res = await request(app)
      .post("/player/register")
      .send({ public_key: VALID_KEY });

    expect(res.status).toBe(200);
    expect(res.body.public_key).toBe(VALID_KEY);
    expect(res.body).toHaveProperty("total_bets");
    expect(res.body).toHaveProperty("created_at");
    expect(res.body).toHaveProperty("updated_at");
  });

  it("returns 200 and passes username to the db query", async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{ ...mockPlayer, username: "lunastar" }],
    } as never);

    const res = await request(app)
      .post("/player/register")
      .send({ public_key: VALID_KEY, username: "lunastar" });

    expect(res.status).toBe(200);
    expect(res.body.username).toBe("lunastar");

    const [sql, params] = vi.mocked(db.query).mock.calls[0]!;
    expect(sql).toContain("ON CONFLICT");
    expect(params).toContain("lunastar");
  });

  it("returns 400 when public_key is missing", async () => {
    const res = await request(app).post("/player/register").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when public_key is not 56 chars", async () => {
    const res = await request(app)
      .post("/player/register")
      .send({ public_key: "GSHORT" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when public_key does not start with G", async () => {
    const res = await request(app)
      .post("/player/register")
      .send({ public_key: `A${"B".repeat(55)}` });
    expect(res.status).toBe(400);
  });

  it("returns 400 when username exceeds 32 chars", async () => {
    const res = await request(app)
      .post("/player/register")
      .send({ public_key: VALID_KEY, username: "x".repeat(33) });
    expect(res.status).toBe(400);
  });

  it("returns 500 without exposing db error details on a db failure", async () => {
    vi.mocked(db.query).mockRejectedValueOnce(new Error("connection refused"));

    const res = await request(app)
      .post("/player/register")
      .send({ public_key: VALID_KEY });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("internal server error");
    expect(JSON.stringify(res.body)).not.toContain("connection refused");
  });
});
