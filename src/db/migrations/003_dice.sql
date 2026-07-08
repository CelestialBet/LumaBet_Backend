-- Dice on-chain bets
-- Tracks the three-phase place_bet → roll_dice → claim_winnings/resolve_lost_bet
-- lifecycle across the core and dice contracts, mirroring coinflip_bets.

CREATE TABLE IF NOT EXISTS dice_bets (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  player_address   VARCHAR(56)  NOT NULL,
  game_type        VARCHAR(20)  NOT NULL DEFAULT 'DICE',
  bet_amount       BIGINT       NOT NULL,   -- in stroops (1 XLM = 10_000_000)
  prediction       SMALLINT     NOT NULL,   -- 1-6
  on_chain_bet_id  BIGINT,                  -- lumabet_core bet_id, set after place_bet
  outcome          SMALLINT,                -- 1-6, NULL until rolled
  won              BOOLEAN,
  payout_amount    BIGINT,                  -- in stroops, NULL if lost or unresolved
  status           VARCHAR(20)  NOT NULL DEFAULT 'building',
  place_tx_hash    VARCHAR(64),
  roll_tx_hash     VARCHAR(64),
  resolve_tx_hash  VARCHAR(64),
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dice_bets_player  ON dice_bets(player_address);
CREATE INDEX IF NOT EXISTS idx_dice_bets_status  ON dice_bets(status);
CREATE INDEX IF NOT EXISTS idx_dice_bets_created ON dice_bets(created_at DESC);
