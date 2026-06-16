import { Request, Response, NextFunction } from "express";

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const { method } = req;
  const path = req.originalUrl ?? req.url;

  res.on("finish", () => {
    const ms = Date.now() - start;
    const { statusCode } = res;
    const level = statusCode >= 500 ? "ERROR" : statusCode >= 400 ? "WARN" : "INFO";
    const ts = new Date().toISOString();
    console.log(`${ts} [${level}] ${method} ${path} ${statusCode} +${ms}ms`);
  });

  next();
}
