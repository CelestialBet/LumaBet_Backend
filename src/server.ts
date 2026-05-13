import express, { Express } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { corsMiddleware } from "./middleware/cors.js";
import { requestLogger } from "./middleware/logger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.js";
import { gameRouter } from "./routes/game.js";
import { walletRouter } from "./routes/wallet.js";

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

  // Rate limiting
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Too many requests, please try again later." },
    })
  );

  // Routes
  app.use("/health", healthRouter);
  app.use("/game", gameRouter);
  app.use("/wallet", walletRouter);

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}
