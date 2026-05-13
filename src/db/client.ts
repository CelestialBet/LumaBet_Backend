import { Pool } from "pg";

if (!process.env["DATABASE_URL"] && process.env["NODE_ENV"] !== "test") {
  console.warn("[db] DATABASE_URL not set — database features will fail");
}

export const db = new Pool({
  connectionString: process.env["DATABASE_URL"],
  min: 2,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl:
    process.env["NODE_ENV"] === "production"
      ? { rejectUnauthorized: true }
      : false,
});

db.on("error", (err) => {
  console.error("[db] Unexpected pool error", err);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  await db.end();
});
