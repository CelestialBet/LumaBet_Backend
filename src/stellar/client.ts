import { SorobanRpc, Contract, xdr, scValToNative, nativeToScVal } from "@stellar/stellar-sdk";

const RPC_URL = process.env["STELLAR_RPC_URL"] ?? "https://soroban-testnet.stellar.org";

const rpcServer = new SorobanRpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") });

/**
 * Call a read-only (view) function on a Soroban contract.
 * Does not require signing — uses simulateTransaction internally.
 */
export async function callContractView<T>(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = []
): Promise<T> {
  const contract = new Contract(contractId);
  const operation = contract.call(method, ...args);

  // Build a minimal transaction to simulate
  const { TransactionBuilder, Account, Networks, BASE_FEE, Transaction } =
    await import("@stellar/stellar-sdk");

  const source = new Account(
    "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "0"
  );

  const networkPassphrase =
    process.env["STELLAR_NETWORK"] === "mainnet"
      ? Networks.PUBLIC
      : Networks.TESTNET;

  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const simResult = await rpcServer.simulateTransaction(tx);

  if (!SorobanRpc.Api.isSimulationSuccess(simResult)) {
    throw new Error(`Contract simulation failed: ${JSON.stringify(simResult)}`);
  }

  const returnVal = simResult.result?.retval;
  if (!returnVal) throw new Error("No return value from contract");

  return scValToNative(returnVal) as T;
}

/**
 * Helper to convert common JS values to ScVal for contract args.
 */
export function toScVal(value: string | number | bigint, type: "u64" | "i128" | "string" | "address"): xdr.ScVal {
  switch (type) {
    case "u64":
      return nativeToScVal(BigInt(value), { type: "u64" });
    case "i128":
      return nativeToScVal(BigInt(value), { type: "i128" });
    case "string":
      return nativeToScVal(String(value), { type: "string" });
    case "address":
      return nativeToScVal(String(value), { type: "address" });
  }
}
