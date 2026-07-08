import {
  Address,
  Contract,
  nativeToScVal,
  SorobanRpc,
  Transaction,
  TransactionBuilder,
  xdr,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { NETWORK_CONFIG } from "../../config/index.js";
import { NetworkType } from "../../types/index.js";

export type ScArg =
  | { type: "address"; value: string }
  | { type: "bytes"; value: Buffer }
  | { type: "i128"; value: bigint }
  | { type: "u64"; value: bigint }
  | { type: "u32"; value: number }
  | { type: "symbol"; value: string };

function toScVal(arg: ScArg): xdr.ScVal {
  switch (arg.type) {
    case "address":
      return new Address(arg.value).toScVal();
    case "bytes":
      return xdr.ScVal.scvBytes(arg.value);
    case "i128":
      return nativeToScVal(arg.value, { type: "i128" });
    case "u64":
      return nativeToScVal(arg.value, { type: "u64" });
    case "u32":
      return nativeToScVal(arg.value, { type: "u32" });
    case "symbol":
      return xdr.ScVal.scvSymbol(arg.value);
  }
}

/**
 * Build a Soroban contract invocation transaction, simulate it to populate
 * the ledger footprint and auth entries, and return the assembled XDR string
 * ready for the client wallet to sign.
 */
export async function buildContractCall(
  callerPublicKey: string,
  contractId: string,
  method: string,
  args: ScArg[],
  network: NetworkType = NetworkType.TESTNET
): Promise<string> {
  const config = NETWORK_CONFIG[network];
  const server = new SorobanRpc.Server(config.sorobanRpcUrl);

  const account = await server.getAccount(callerPublicKey);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args.map(toScVal)))
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
  return assembled.toXDR();
}

/**
 * Parse the return value of a successfully confirmed Soroban transaction.
 * Returns the raw ScVal or null if the transaction had no return value.
 */
export function parseReturnValue(
  getResponse: SorobanRpc.Api.GetSuccessfulTransactionResponse
): xdr.ScVal | null {
  return getResponse.returnValue ?? null;
}

export interface SubmitResult {
  hash: string;
  ledger: number;
  returnValue?: xdr.ScVal;
}

/**
 * Submit a signed transaction and poll until confirmed or failed.
 * Returns a flat object with the tx hash, ledger number, and optional return value.
 */
export async function submitAndWait(
  signedXdr: string,
  network: NetworkType = NetworkType.TESTNET
): Promise<SubmitResult> {
  const config = NETWORK_CONFIG[network];
  const server = new SorobanRpc.Server(config.sorobanRpcUrl);

  const { hash, status, errorResult } = await server.sendTransaction(
    new Transaction(signedXdr, config.networkPassphrase)
  );

  if (status === "ERROR") {
    throw new Error(`Transaction rejected: ${JSON.stringify(errorResult)}`);
  }

  let getResponse = await server.getTransaction(hash);
  let attempts = 0;

  while (
    getResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
    attempts < 30
  ) {
    await new Promise((r) => setTimeout(r, 1000));
    getResponse = await server.getTransaction(hash);
    attempts++;
  }

  if (getResponse.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    const ok = getResponse as SorobanRpc.Api.GetSuccessfulTransactionResponse;
    return { hash, ledger: ok.ledger, returnValue: ok.returnValue };
  }

  throw new Error(
    `Transaction not confirmed after ${attempts}s — status: ${getResponse.status}`
  );
}
