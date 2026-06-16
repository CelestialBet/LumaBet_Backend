# Contributing to LumaBet Backend

## Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- PostgreSQL 15+ running locally
- A funded Stellar testnet account (see [TESTNET.md](../TESTNET.md))

## Setup

```bash
pnpm install
cp .env.example .env
# Fill in DATABASE_URL and the other required vars

# Run migrations
psql "$DATABASE_URL" -f src/db/migrations/001_initial.sql
psql "$DATABASE_URL" -f src/db/migrations/002_coinflip.sql
```

## Project layout

```
src/
  db/
    client.ts           # pg Pool singleton
    migrations/         # ordered SQL migration files
  middleware/
    errorHandler.ts     # AppError + Express error handler
    logger.ts           # request timing logger
    security.ts         # rate limiting, input validation, env guard
  routes/
    api.ts              # /api/games/* and /api/stats routes
  services/
    coinflipService.ts  # commit / reveal / settle business logic
    stellarService.ts   # Horizon + SorobanRpc helpers
  index.ts              # validateEnv() + server startup
  server.ts             # Express app factory
```

## Running tests

```bash
pnpm test               # run once with coverage
pnpm test:watch         # watch mode
```

Tests use Vitest. Mocks live inside each `__tests__/` file using `vi.mock()`. Do not add integration tests that hit a live database or Stellar network — keep unit tests deterministic.

## Environment variables

All required vars are listed in `.env.example`. `validateEnv()` in `src/index.ts` will throw at startup if any are missing. Never commit a real `.env` file.

## Security middleware

All external input goes through `express-validator` chains in `security.ts`. Add new routes to existing validator arrays or create a new `validate*` export — do not inline validation logic in route handlers.

## Pull requests

1. Branch from `main`.
2. `pnpm type-check` and `pnpm lint` must pass.
3. Maintain ≥80% test coverage (`pnpm test` reports coverage).
4. All new routes need at least one happy-path and one error-path test.
5. Serialize BigInt values before `res.json()` (`.toString()`).
6. Never commit `.env` files, `node_modules/`, or `dist/`.
