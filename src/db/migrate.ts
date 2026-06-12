import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./client.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dir, "migrations");

async function migrate() {
  const client = await db.connect();
  try {
    // Ensure tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { rows: applied } = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations ORDER BY version"
    );
    const appliedSet = new Set(applied.map((r) => r.version));

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (appliedSet.has(file)) continue;

      console.log(`[migrate] applying ${file}…`);
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf-8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version) VALUES ($1)",
          [file]
        );
        await client.query("COMMIT");
        ran++;
        console.log(`[migrate] ✓ ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    if (ran === 0) {
      console.log("[migrate] nothing to apply — schema is up to date");
    } else {
      console.log(`[migrate] applied ${ran} migration(s)`);
    }
  } finally {
    client.release();
    await db.end();
  }
}

migrate().catch((err) => {
  console.error("[migrate] FAILED:", err.message);
  process.exit(1);
});
