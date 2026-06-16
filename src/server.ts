import express, { Express } from "express";
import helmet from "helmet";
import { corsMiddleware } from "./middleware/cors.js";
import { requestLogger } from "./middleware/logger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { globalLimiter } from "./middleware/security.js";
import { healthRouter } from "./routes/health.js";
import { gameRouter } from "./routes/game.js";
import { walletRouter } from "./routes/wallet.js";
import { playerRouter } from "./routes/player.js";
import { coinFlipRouter } from "./routes/coinflip.js";
import { apiRouter } from "./routes/api.js";

export function createServer(): Express {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS
  app.use(corsMiddleware);

  // Body parsing
  app.use(express.json({ limit: "10kb" }));
  app.use(express.urlencoded({ extended: false }));

  // Request logging
  app.use(requestLogger);

  // Global rate limiting (100 req / 15 min per IP)
  app.use(globalLimiter);

  // Routes
  app.use("/health", healthRouter);
  app.use("/game", gameRouter);
  app.use("/game/coinflip", coinFlipRouter);
  app.use("/api/games", apiRouter);
  app.use("/wallet", walletRouter);
  app.use("/player", playerRouter);

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}
