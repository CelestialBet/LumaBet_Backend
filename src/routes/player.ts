import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";

export const playerRouter: Router = Router();

const RegisterSchema = z.object({
  public_key: z
    .string()
    .length(56, "public_key must be 56 characters")
    .refine((v) => v.startsWith("G"), "public_key must start with G"),
  username: z.string().max(32, "username must be 32 characters or fewer").optional(),
});

interface PlayerRow {
  public_key: string;
  username: string | null;
  total_bets: number;
  total_won: string;
  total_lost: string;
  created_at: string;
  updated_at: string;
}

playerRouter.post("/register", async (req, res, next) => {
  try {
    const body = RegisterSchema.parse(req.body);

    let result;
    try {
      result = await db.query<PlayerRow>(
        `INSERT INTO players (public_key, display_name)
         VALUES ($1, $2)
         ON CONFLICT (public_key) DO UPDATE
           SET display_name = EXCLUDED.display_name,
               updated_at   = NOW()
         RETURNING
           public_key,
           display_name AS username,
           total_bets,
           total_won,
           total_lost,
           created_at,
           updated_at`,
        [body.public_key, body.username ?? null]
      );
    } catch (dbErr) {
      console.error("[player] db error on register:", dbErr);
      res.status(500).json({ error: "internal server error" });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});
