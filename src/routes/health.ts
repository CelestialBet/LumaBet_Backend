import { Router } from "express";
import { db } from "../db/client.js";
import { HealthResponse } from "../types/index.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const health: HealthResponse = {
    status: "ok",
    version: process.env["npm_package_version"] ?? "0.1.0",
    timestamp: new Date().toISOString(),
    services: {
      database: "ok",
      stellar: "ok",
    },
  };

  // Check DB connectivity
  try {
    await db.query("SELECT 1");
  } catch {
    health.services.database = "down";
    health.status = "degraded";
  }

  // Check Stellar Horizon reachability
  try {
    const horizonUrl = process.env["STELLAR_HORIZON_URL"] ?? "https://horizon-testnet.stellar.org";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(`${horizonUrl}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error("Horizon unreachable");
  } catch {
    health.services.stellar = "down";
    health.status = "degraded";
  }

  const httpStatus = health.status === "ok" ? 200 : 503;
  res.status(httpStatus).json(health);
});
