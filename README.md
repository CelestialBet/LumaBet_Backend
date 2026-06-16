# LumaBet Backend

Node.js + Express + TypeScript REST API for the CelestialBet decentralized casino.

## Stack

- **Express 4** + TypeScript
- **PostgreSQL** — off-chain bet history & leaderboards
- **Stellar SDK** — Horizon reads & Soroban RPC calls
- **express-validator** — request validation and sanitization
- **Helmet + rate-limit** — security headers and brute-force protection
- **Zod** — additional schema validation

## Getting Started

```bash
pnpm install
cp .env.example .env   # fill in DATABASE_URL, STELLAR_*, CONTRACT IDs, JWT_SECRET

# Run migrations
psql "$DATABASE_URL" -f src/db/migrations/001_initial.sql
psql "$DATABASE_URL" -f src/db/migrations/002_coinflip.sql

pnpm dev               # http://localhost:3001
```

## Scripts

| Command           | Description                          |
|-------------------|--------------------------------------|
| `pnpm dev`        | tsx watch (hot reload)               |
| `pnpm build`      | TypeScript compile to dist/          |
| `pnpm start`      | Run compiled dist/                   |
| `pnpm lint`       | ESLint                               |
| `pnpm type-check` | TypeScript strict check              |
| `pnpm test`       | Vitest with coverage report (≥80%)   |
| `pnpm test:watch` | Vitest in watch mode                 |

## API Routes

### Health

| Method | Route     | Description                     |
|--------|-----------|---------------------------------|
| GET    | `/health` | Service + dependency health     |

### Coin Flip (`/api/games/coinflip`)

| Method | Route                                 | Description                                 |
|--------|---------------------------------------|---------------------------------------------|
| POST   | `/api/games/coinflip/commit`          | Phase 1 — lock in bet, returns commit XDR   |
| POST   | `/api/games/coinflip/reveal`          | Phase 2 — submit signed commit, get reveal XDR |
| POST   | `/api/games/coinflip/settle`          | Phase 3 — submit signed reveal, get outcome |
| POST   | `/api/games/coinflip/cancel`          | Cancel a timed-out uncommitted bet          |
| GET    | `/api/games/coinflip/status/:address` | Latest bet status for a player              |
| GET    | `/api/games/coinflip/history`         | Paginated bet history (`?playerAddress=&limit=&offset=`) |

### Stats

| Method | Route        | Description                                         |
|--------|--------------|-----------------------------------------------------|
| GET    | `/api/stats` | Aggregate totals: bets, wagered, paid out, profit   |

## Coin Flip Flow

```
Client                          Backend                       Stellar
  |── POST /commit ─────────────▶|                              |
  |                              |── build commit tx ──────────▶|
  |◀─ { commitXdr, betDbId } ───|                              |
  |── sign commitXdr (Freighter) |                              |
  |── POST /reveal ─────────────▶|                              |
  |                              |── submit commit tx ─────────▶|
  |                              |── build reveal tx ──────────▶|
  |◀─ { revealXdr } ────────────|                              |
  |── sign revealXdr (Freighter) |                              |
  |── POST /settle ─────────────▶|                              |
  |                              |── submit reveal tx ─────────▶|
  |◀─ { outcome, won, payout } ─|                              |
```

## Security

- Rate limiting: 100 req/15 min globally; 5 commits/min per IP (`commitLimiter`)
- All inputs validated with `express-validator` before reaching service layer
- `validateEnv()` throws at startup if required env vars are absent
- Request timestamps logged on every response

## Docs

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and conventions.
