import { Horizon, Keypair } from "@stellar/stellar-sdk";
import { NETWORK_CONFIG, STROOPS_PER_XLM } from "../../config/index.js";
import {
  NetworkType,
  WalletBalanceResponse,
  FreighterNetwork,
} from "../../types/index.js";

/**
 * Fetch the XLM balance for a Stellar account from Horizon.
 */
export async function getBalance(
  publicKey: string,
  network: NetworkType = NetworkType.TESTNET
): Promise<WalletBalanceResponse> {
  const config = NETWORK_CONFIG[network];
  const server = new Horizon.Server(config.horizonUrl);

  const account = await server.loadAccount(publicKey);
  const nativeBalance = account.balances.find((b) => b.asset_type === "native");

  const xlmBalance = nativeBalance?.balance ?? "0";
  const xlmBalanceStroops = (
    BigInt(Math.floor(parseFloat(xlmBalance) * 10_000_000))
  ).toString();

  return {
    publicKey,
    xlmBalance,
    xlmBalanceStroops,
    network,
  };
}

/**
 * Validate a Stellar public key format.
 */
export function isValidPublicKey(publicKey: string): boolean {
  try {
    Keypair.fromPublicKey(publicKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert XLM string to stroops (bigint).
 */
export function xlmToStroops(xlm: string): bigint {
  const [whole, decimal = "0"] = xlm.split(".");
  const paddedDecimal = decimal.padEnd(7, "0").slice(0, 7);
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(paddedDecimal);
}

/**
 * Convert stroops (string|bigint) to XLM string.
 */
export function stroopsToXlm(stroops: string | bigint): string {
  const s = typeof stroops === "string" ? BigInt(stroops) : stroops;
  const whole = s / STROOPS_PER_XLM;
  const remainder = s % STROOPS_PER_XLM;
  return `${whole}.${remainder.toString().padStart(7, "0")}`;
}

/**
 * Fund a testnet account using Friendbot.
 */
export async function fundTestnetAccount(publicKey: string): Promise<void> {
  const friendbotUrl = NETWORK_CONFIG[NetworkType.TESTNET].friendbotUrl;
  const response = await fetch(`${friendbotUrl}?addr=${publicKey}`);
  if (!response.ok) {
    throw new Error(`Friendbot failed: ${response.statusText}`);
  }
}

/**
 * Map a Freighter network name to our NetworkType enum.
 */
export function freighterNetworkToType(network: FreighterNetwork): NetworkType {
  const passphrase = network.networkPassphrase;
  if (passphrase === NETWORK_CONFIG[NetworkType.MAINNET].networkPassphrase) {
    return NetworkType.MAINNET;
  }
  if (passphrase === NETWORK_CONFIG[NetworkType.FUTURENET].networkPassphrase) {
    return NetworkType.FUTURENET;
  }
  return NetworkType.TESTNET;
}
