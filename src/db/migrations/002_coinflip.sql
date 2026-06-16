-- Coin-flip commit-reveal bets
-- Separate from the generic bets table in 001_init.sql because this schema
-- tracks the two-phase commit/reveal lifecycle with per-phase tx hashes.

CREATE TABLE IF NOT EXISTS coinflip_bets (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  player_address   VARCHAR(56)  NOT NULL,
  game_type        VARCHAR(20)  NOT NULL DEFAULT 'COIN_FLIP',
  bet_amount       BIGINT       NOT NULL,   -- in stroops (1 XLM = 10_000_000)
  player_choice    SMALLINT,               -- 0 = heads, 1 = tails
  outcome          SMALLINT,               -- 0 = heads, 1 = tails, NULL until revealed
  payout_amount    BIGINT,                 -- in stroops, NULL if lost or unresolved
  status           VARCHAR(20)  NOT NULL DEFAULT 'committed',
  commit_tx_hash   VARCHAR(64),
  reveal_tx_hash   VARCHAR(64),
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_coinflip_bets_player ON coinflip_bets(player_address);
CREATE INDEX IF NOT EXISTS idx_coinflip_bets_status  ON coinflip_bets(status);
CREATE INDEX IF NOT EXISTS idx_coinflip_bets_created ON coinflip_bets(created_at DESC);
