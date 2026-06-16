import "dotenv/config";
import { validateEnv } from "./middleware/security.js";
import { createServer } from "./server.js";
import { db } from "./db/client.js";

validateEnv(); // fails fast if required env vars are absent

const PORT = parseInt(process.env["PORT"] ?? "3001", 10);

process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandledRejection:", reason);
  process.exit(1);
});

const app = createServer();

const server = app.listen(PORT, () => {
  console.log(`[lumabet-api] listening on http://localhost:${PORT}`);
  console.log(`[lumabet-api] env: ${process.env["NODE_ENV"] ?? "development"}`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[lumabet-api] port ${PORT} is already in use`);
  } else {
    console.error("[lumabet-api] server error:", err);
  }
  process.exit(1);
});

async function shutdown(signal: string) {
  console.log(`\n[lumabet-api] ${signal} received — shutting down`);
  server.close(async () => {
    await db.end();
    console.log("[lumabet-api] closed");
    process.exit(0);
  });
  // Force exit after 10 s if graceful shutdown hangs
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
