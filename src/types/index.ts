// ── Enums ─────────────────────────────────────────────────────────────────────

export enum GameType {
  DICE = "DICE",
  COIN_FLIP = "COIN_FLIP",
  SLOTS = "SLOTS",
}

export enum BetStatus {
  PENDING = "PENDING",
  WON = "WON",
  LOST = "LOST",
  WITHDRAWN = "WITHDRAWN",
  EXPIRED = "EXPIRED",
}

export enum NetworkType {
  TESTNET = "testnet",
  MAINNET = "mainnet",
  FUTURENET = "futurenet",
}

export enum TransactionStatus {
  PENDING = "PENDING",
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
}

// ── Core Domain Types ─────────────────────────────────────────────────────────

export interface Player {
  publicKey: string;
  displayName?: string;
  totalBets: number;
  totalWagered: string; // XLM amount as string to avoid float precision issues
  totalWon: string;
  totalLost: string;
  createdAt: string; // ISO 8601
}

export interface Bet {
  id: string; // on-chain bet ID (ledger timestamp as string)
  player: string; // Stellar public key
  gameType: GameType;
  prediction: number;
  amount: string; // XLM in stroops (1 XLM = 10_000_000 stroops)
  amountXlm: string; // Human-readable XLM
  status: BetStatus;
  outcome?: number;
  payout?: string; // XLM in stroops
  payoutXlm?: string;
  transactionHash?: string;
  contractId: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface GameResult {
  betId: string;
  gameType: GameType;
  player: string;
  prediction: number;
  outcome: number;
  won: boolean;
  payout: string; // XLM amount
  transactionHash: string;
  ledgerSequence: number;
  timestamp: string;
}

export interface DiceGameConfig {
  minBetXlm: string;
  maxBetXlm: string;
  payoutMultiplier: number; // e.g. 5 for 5x
  houseEdgeBps: number; // basis points, e.g. 200 = 2%
  contractId: string;
}

export interface Transaction {
  id: string;
  hash: string;
  type: "BET" | "PAYOUT" | "WITHDRAW" | "DEPOSIT";
  player: string;
  amount: string;
  amountXlm: string;
  status: TransactionStatus;
  ledgerSequence?: number;
  fee?: string;
  memo?: string;
  createdAt: string;
}

// ── API Request / Response Types ──────────────────────────────────────────────

export interface PlaceDiceBetRequest {
  playerPublicKey: string;
  amountXlm: string;
  prediction: number; // 1–6
  signedXdr: string; // Transaction XDR signed by Freighter
}

export interface PlaceDiceBetResponse {
  betId: string;
  transactionHash: string;
  status: BetStatus;
  message: string;
}

export interface GameHistoryQuery {
  playerPublicKey?: string;
  gameType?: GameType;
  status?: BetStatus;
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface WalletBalanceResponse {
  publicKey: string;
  xlmBalance: string;
  xlmBalanceStroops: string;
  network: NetworkType;
}

export interface HealthResponse {
  status: "ok" | "degraded" | "down";
  version: string;
  timestamp: string;
  services: {
    database: "ok" | "down";
    stellar: "ok" | "down";
  };
}

// ── Wallet / Freighter Types ──────────────────────────────────────────────────

export interface WalletState {
  isConnected: boolean;
  publicKey: string | null;
  network: NetworkType | null;
  balance: string | null;
  isLoading: boolean;
  error: string | null;
}

export interface FreighterNetwork {
  network: string;
  networkPassphrase: string;
}

// ── Contract Types ────────────────────────────────────────────────────────────

export interface ContractAddresses {
  core: string;
  dice: string;
  rng: string;
}

export interface SorobanCallResult<T> {
  success: boolean;
  value?: T;
  error?: string;
  transactionHash?: string;
}
