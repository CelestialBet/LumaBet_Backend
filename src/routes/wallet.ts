import { Router } from "express";
import { z } from "zod";
import { getBalance, isValidPublicKey } from "../lib/stellar-client/index.js";
import { NetworkType } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";

export const walletRouter = Router();

const BalanceParams = z.object({
  publicKey: z.string().min(56).max(56),
});

walletRouter.get("/balance/:publicKey", async (req, res, next) => {
  try {
    const { publicKey } = BalanceParams.parse(req.params);

    if (!isValidPublicKey(publicKey)) {
      throw new AppError(400, "Invalid Stellar public key", "INVALID_PUBLIC_KEY");
    }

    const network = (process.env["STELLAR_NETWORK"] as NetworkType) ?? NetworkType.TESTNET;
    const balance = await getBalance(publicKey, network);
    res.json(balance);
  } catch (err) {
    next(err);
  }
});
