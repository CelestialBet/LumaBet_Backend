-- LumaBet initial schema
-- Run with: pnpm migrate

-- Track applied migrations
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Players (created on first bet; no auth required beyond public key)
CREATE TABLE IF NOT EXISTS players (
  public_key    TEXT        PRIMARY KEY,
  display_name  TEXT,
  total_bets    INTEGER     NOT NULL DEFAULT 0,
  total_wagered NUMERIC(20,7) NOT NULL DEFAULT 0,
  total_won     NUMERIC(20,7) NOT NULL DEFAULT 0,
  total_lost    NUMERIC(20,7) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bets
CREATE TABLE IF NOT EXISTS bets (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  player_public_key  TEXT         NOT NULL REFERENCES players(public_key),
  game_type          TEXT         NOT NULL CHECK (game_type IN ('DICE','COIN_FLIP','SLOTS')),
  prediction         INTEGER      NOT NULL,
  amount_xlm         NUMERIC(20,7) NOT NULL,
  outcome            INTEGER,
  status             TEXT         NOT NULL DEFAULT 'PENDING'
                                   CHECK (status IN ('PENDING','WON','LOST','WITHDRAWN','EXPIRED')),
  payout_xlm         NUMERIC(20,7),
  transaction_hash   TEXT,
  contract_bet_id    BIGINT,       -- the uint64 ID from the on-chain BET_COUNTER
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  resolved_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS bets_player_idx ON bets(player_public_key);
CREATE INDEX IF NOT EXISTS bets_status_idx ON bets(status);
CREATE INDEX IF NOT EXISTS bets_created_at_idx ON bets(created_at DESC);

-- Auto-update players.updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER players_updated_at
  BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
