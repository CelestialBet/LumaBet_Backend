# LumaBet Backend

Node.js + Express + TypeScript REST API for the CelestialBet decentralized casino.

## Stack
- **Express 4** + TypeScript
- **PostgreSQL** — off-chain bet history & leaderboards
- **Stellar SDK** — Horizon reads & Soroban RPC calls
- **Zod** — request validation
- **Helmet + rate-limit** — security

## Getting Started

```bash
pnpm install
cp .env.example .env   # set DATABASE_URL, STELLAR_*, CONTRACT IDs
psql $DATABASE_URL -f ../LumaBet_contract/scripts/seed_db.sql
pnpm dev               # http://localhost:3001
```

## Scripts

| Command          | Description              |
|------------------|--------------------------|
| `pnpm dev`       | tsx watch (hot reload)   |
| `pnpm build`     | TypeScript compile       |
| `pnpm start`     | Run compiled dist/       |
| `pnpm lint`      | ESLint                   |
| `pnpm type-check`| TypeScript strict check  |
| `pnpm test`      | Vitest                   |

## API Routes

| Method | Route                        | Description              |
|--------|------------------------------|--------------------------|
| GET    | `/health`                    | Service + dependency health |
| GET    | `/wallet/balance/:publicKey` | XLM balance via Horizon  |
| POST   | `/game/dice`                 | Place a dice bet         |
| GET    | `/game/history`              | Paginated bet history    |

## Docs

See [docs/api.md](docs/api.md) for full request/response reference.
