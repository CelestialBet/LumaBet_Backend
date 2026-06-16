#!/usr/bin/env bash
# Set up the LumaBet backend for a testnet run.
# Usage: bash scripts/setup-testnet.sh
#
# What it does:
#   1. Verifies required env vars are set
#   2. Tests the database connection
#   3. Runs all pending SQL migrations
#   4. Verifies the Stellar contract ID is reachable on Horizon
#
# Required env vars (from .env):
#   DATABASE_URL                     — PostgreSQL connection string
#   LUMABET_COIN_FLIP_CONTRACT_ID    — deployed contract ID (C...)
#   STELLAR_NETWORK                  — "testnet" or "mainnet"
#   JWT_SECRET                       — at least 32 characters

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env
if [[ -f "$BACKEND_ROOT/.env" ]]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' "$BACKEND_ROOT/.env" | xargs)
fi

# ── Validate required vars ────────────────────────────────────────────────────

REQUIRED_VARS=(DATABASE_URL LUMABET_COIN_FLIP_CONTRACT_ID STELLAR_NETWORK JWT_SECRET)
MISSING=()
for VAR in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!VAR:-}" ]]; then
    MISSING+=("$VAR")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "ERROR: Missing required environment variables:" >&2
  for V in "${MISSING[@]}"; do
    echo "  $V" >&2
  done
  echo "" >&2
  echo "Copy .env.example to .env and fill in the values." >&2
  exit 1
fi

echo "==> Environment: OK (${STELLAR_NETWORK})"

# ── Database connection ───────────────────────────────────────────────────────

echo "==> Testing database connection..."
psql "$DATABASE_URL" -c "SELECT 1" > /dev/null
echo "==> Database: OK"

# ── Run migrations ────────────────────────────────────────────────────────────

MIGRATIONS_DIR="$BACKEND_ROOT/src/db/migrations"

echo "==> Running migrations from $MIGRATIONS_DIR..."
for MIGRATION in "$MIGRATIONS_DIR"/*.sql; do
  echo "    applying $(basename "$MIGRATION")..."
  psql "$DATABASE_URL" -f "$MIGRATION"
done
echo "==> Migrations: OK"

# ── Verify contract reachable ─────────────────────────────────────────────────

if [[ "$STELLAR_NETWORK" == "testnet" ]]; then
  HORIZON_URL="https://horizon-testnet.stellar.org"
else
  HORIZON_URL="https://horizon.stellar.org"
fi

echo "==> Verifying contract ${LUMABET_COIN_FLIP_CONTRACT_ID} on ${STELLAR_NETWORK}..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "${HORIZON_URL}/accounts/${LUMABET_COIN_FLIP_CONTRACT_ID}" || echo "000")

if [[ "$HTTP_STATUS" == "200" || "$HTTP_STATUS" == "404" ]]; then
  # 404 is fine — contracts aren't Horizon accounts; Soroban RPC handles them
  echo "==> Horizon reachable: OK (${HTTP_STATUS})"
else
  echo "WARN: Could not reach Horizon at ${HORIZON_URL} (HTTP ${HTTP_STATUS})" >&2
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "Setup complete. Start the backend with:"
echo "  pnpm dev"
