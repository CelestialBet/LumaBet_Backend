import { NetworkType } from "../types/index.js";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export function loadServerConfig() {
  return {
    port: parseInt(optionalEnv("PORT", "3001"), 10),
    nodeEnv: optionalEnv("NODE_ENV", "development"),
    corsOrigin: optionalEnv("CORS_ORIGIN", "http://localhost:5173"),
    jwtSecret: requireEnv("JWT_SECRET"),
    jwtExpiresIn: optionalEnv("JWT_EXPIRES_IN", "7d"),
    logLevel: optionalEnv("LOG_LEVEL", "info"),

    database: {
      url: requireEnv("DATABASE_URL"),
      poolMin: 2,
      poolMax: 10,
    },

    stellar: {
      network: optionalEnv("STELLAR_NETWORK", "testnet") as NetworkType,
      horizonUrl: optionalEnv(
        "STELLAR_HORIZON_URL",
        "https://horizon-testnet.stellar.org"
      ),
      rpcUrl: optionalEnv(
        "STELLAR_RPC_URL",
        "https://soroban-testnet.stellar.org"
      ),
      networkPassphrase: optionalEnv(
        "STELLAR_NETWORK_PASSPHRASE",
        "Test SDF Network ; September 2015"
      ),
      adminSecretKey: optionalEnv("ADMIN_SECRET_KEY", ""),
    },

    contracts: {
      core: optionalEnv("LUMABET_CORE_CONTRACT_ID", ""),
      dice: optionalEnv("LUMABET_DICE_CONTRACT_ID", ""),
      rng: optionalEnv("LUMABET_RNG_CONTRACT_ID", ""),
    },
  } as const;
}

export type ServerConfig = ReturnType<typeof loadServerConfig>;
