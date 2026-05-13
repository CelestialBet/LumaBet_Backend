import { NetworkType } from "../types/index.js";

// ── Network ───────────────────────────────────────────────────────────────────

export const NETWORK_CONFIG = {
  [NetworkType.TESTNET]: {
    networkPassphrase: "Test SDF Network ; September 2015",
    horizonUrl: "https://horizon-testnet.stellar.org",
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    friendbotUrl: "https://friendbot.stellar.org",
    explorerUrl: "https://stellar.expert/explorer/testnet",
  },
  [NetworkType.MAINNET]: {
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    horizonUrl: "https://horizon.stellar.org",
    sorobanRpcUrl: "https://soroban-mainnet.stellar.org",
    friendbotUrl: null,
    explorerUrl: "https://stellar.expert/explorer/public",
  },
  [NetworkType.FUTURENET]: {
    networkPassphrase: "Test SDF Future Network ; October 2022",
    horizonUrl: "https://horizon-futurenet.stellar.org",
    sorobanRpcUrl: "https://rpc-futurenet.stellar.org",
    friendbotUrl: "https://friendbot-futurenet.stellar.org",
    explorerUrl: "https://stellar.expert/explorer/futurenet",
  },
} as const;

// ── XLM Units ─────────────────────────────────────────────────────────────────

export const STROOPS_PER_XLM = 10_000_000n;
export const MIN_ACCOUNT_BALANCE_XLM = "1"; // Stellar base reserve
export const BASE_FEE_STROOPS = 100;

// ── Game Config ───────────────────────────────────────────────────────────────

export const DICE_CONFIG = {
  minBetXlm: "1",
  maxBetXlm: "1000",
  faces: 6,
  payoutMultiplierBps: 50_000, // 5x
  houseEdgeBps: 200, // 2%
  validPredictions: [1, 2, 3, 4, 5, 6] as const,
};

export const HOUSE_EDGE_BPS = 200; // 2% across all games

// ── API ───────────────────────────────────────────────────────────────────────

export const API_VERSION = "v1";
export const API_RATE_LIMIT_WINDOW_MS = 60_000;
export const API_RATE_LIMIT_MAX_REQUESTS = 100;

// ── Database ──────────────────────────────────────────────────────────────────

export const DB_POOL_MIN = 2;
export const DB_POOL_MAX = 10;
export const DB_CONNECTION_TIMEOUT_MS = 5_000;

// ── Timeouts ──────────────────────────────────────────────────────────────────

export const STELLAR_TX_TIMEOUT_SECONDS = 30;
export const BET_EXPIRY_SECONDS = 300; // 5 minutes to resolve
