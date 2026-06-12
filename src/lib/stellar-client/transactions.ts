import {
  Horizon,
  Memo,
  Networks,
  TransactionBuilder,
  Operation,
  Asset,
  BASE_FEE,
  Transaction,
  xdr,
} from "@stellar/stellar-sdk";
import { SorobanRpc } from "@stellar/stellar-sdk";
import { NETWORK_CONFIG, STELLAR_TX_TIMEOUT_SECONDS } from "../../config/index.js";
import { NetworkType, SorobanCallResult } from "../../types/index.js";

/**
 * Submit a signed transaction XDR to the Stellar network.
 */
export async function submitTransaction(
  signedXdr: string,
  network: NetworkType = NetworkType.TESTNET
): Promise<SorobanCallResult<string>> {
  const config = NETWORK_CONFIG[network];

  try {
    const rpcServer = new SorobanRpc.Server(config.sorobanRpcUrl);
    const tx = new Transaction(signedXdr, config.networkPassphrase);
    const response = await rpcServer.sendTransaction(tx);

    if (response.status === "ERROR") {
      return {
        success: false,
        error: `Transaction failed: ${JSON.stringify(response.errorResult)}`,
      };
    }

    // Poll for confirmation
    const hash = response.hash;
    let getResponse = await rpcServer.getTransaction(hash);
    let attempts = 0;

    while (
      getResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
      attempts < 30
    ) {
      await new Promise((r) => setTimeout(r, 1000));
      getResponse = await rpcServer.getTransaction(hash);
      attempts++;
    }

    if (getResponse.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return { success: true, value: hash, transactionHash: hash };
    }

    return {
      success: false,
      error: `Transaction not confirmed after ${attempts} attempts`,
      transactionHash: hash,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Build a payment transaction (XLM transfer) for signing by the client wallet.
 * Returns the unsigned XDR string.
 */
export async function buildPaymentTransaction(
  senderPublicKey: string,
  destinationPublicKey: string,
  amountXlm: string,
  memo: string | undefined,
  network: NetworkType = NetworkType.TESTNET
): Promise<string> {
  const config = NETWORK_CONFIG[network];
  const server = new Horizon.Server(config.horizonUrl);

  const account = await server.loadAccount(senderPublicKey);

  const networkPassphrase =
    network === NetworkType.MAINNET
      ? Networks.PUBLIC
      : network === NetworkType.FUTURENET
      ? Networks.FUTURENET
      : Networks.TESTNET;

  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: destinationPublicKey,
        asset: Asset.native(),
        amount: amountXlm,
      })
    )
    .setTimeout(STELLAR_TX_TIMEOUT_SECONDS);

  if (memo) {
    builder.addMemo(Memo.text(memo));
  }

  return builder.build().toXDR();
}

/**
 * Decode a transaction XDR and return a human-readable summary.
 */
export function decodeTransactionXdr(xdrString: string): {
  operations: string[];
  memo?: string;
} {
  try {
    const envelope = xdr.TransactionEnvelope.fromXDR(xdrString, "base64");
    const ops = envelope.v1().tx().operations();
    return {
      operations: ops.map((op) => op.body().switch().name),
    };
  } catch {
    return { operations: [] };
  }
}
