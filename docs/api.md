# LumaBet REST API Reference

Base URL: `http://localhost:3001` (development)

All responses are JSON. Error responses follow:
```json
{ "error": "Human-readable message", "code": "OPTIONAL_CODE" }
```

---

## Health

### `GET /health`

Check service and dependency health.

**Response 200**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "services": {
    "database": "ok",
    "stellar": "ok"
  }
}
```

---

## Wallet

### `GET /wallet/balance/:publicKey`

Fetch the XLM balance for a Stellar account.

**Path params**
| Param       | Type   | Description               |
|-------------|--------|---------------------------|
| `publicKey` | string | Stellar G… public key (56 chars) |

**Response 200**
```json
{
  "publicKey": "GAAZI4...",
  "xlmBalance": "9842.1230000",
  "xlmBalanceStroops": "98421230000",
  "network": "testnet"
}
```

**Errors**
| Status | Code                | Description                   |
|--------|---------------------|-------------------------------|
| 400    | `INVALID_PUBLIC_KEY`| Key fails Stellar validation  |
| 404    | —                   | Account not found on network  |

---

## Dice (`/api/games/dice`)

On-chain integration spanning `lumabet_core` (escrow) and `lumabet_dice`
(roll + resolution). Each phase requires a fresh Freighter signature since the
API never holds a key capable of moving funds.

### `POST /api/games/dice/place`

Build the `place_bet` XDR and store a pending record.

**Request body**
```json
{ "playerAddress": "GAAZI4...", "amountXlm": "10", "prediction": 4 }
```

**Response 201**
```json
{ "placeXdr": "AAAAAgAAAA...", "betDbId": "3f8a2c10-..." }
```

### `POST /api/games/dice/roll`

Submit the signed `place_bet` transaction, read the on-chain `bet_id`, and
build the `roll_dice` XDR.

**Request body**
```json
{ "playerAddress": "GAAZI4...", "betDbId": "3f8a2c10-...", "signedPlaceXdr": "AAAAAgAAAA..." }
```

**Response 200**
```json
{ "rollXdr": "AAAAAgAAAA...", "onChainBetId": "42", "placeTxHash": "a1b2c3..." }
```

### `POST /api/games/dice/resolve`

Submit the signed `roll_dice` transaction, read the outcome, and build the
`claim_winnings` (won) or `resolve_lost_bet` (lost) XDR.

**Request body**
```json
{ "playerAddress": "GAAZI4...", "betDbId": "3f8a2c10-...", "signedRollXdr": "AAAAAgAAAA..." }
```

**Response 200**
```json
{ "resolveXdr": "AAAAAgAAAA...", "outcome": 4, "won": true, "rollTxHash": "a1b2c3..." }
```

### `POST /api/games/dice/finalize`

Submit the signed `claim_winnings`/`resolve_lost_bet` transaction, which pays
the winner on-chain, and record the final result.

**Request body**
```json
{ "playerAddress": "GAAZI4...", "betDbId": "3f8a2c10-...", "signedResolveXdr": "AAAAAgAAAA..." }
```

**Response 200**
```json
{ "outcome": 4, "won": true, "payoutStroops": "49000000", "status": "won", "resolveTxHash": "a1b2c3..." }
```

### `GET /api/games/dice/status/:address`

Latest dice bet for a player.

### `GET /api/games/dice/history`

Paginated dice bet history (`?playerAddress=&limit=&offset=`).

**Errors** (all dice endpoints)
| Status | Code             | Description                          |
|--------|------------------|---------------------------------------|
| 400    | `VALIDATION_ERROR` | Validation failed (Zod error detail) |
| 404    | —                | Bet not found for the given betDbId  |
| 422    | `TX_ERROR`       | Stellar transaction rejected or return value unparseable |
| 429    | —                | Rate limit exceeded                  |

---

## Game (legacy)

### `POST /game/dice`

> **Deprecated** — builds a plain payment transaction rather than invoking
> `lumabet_core`/`lumabet_dice` and never resolves the bet. Prefer
> `/api/games/dice/*` above. Kept for backward compatibility with the
> existing frontend `Dice` page.

Place a dice bet. The caller must include a **signed transaction XDR** obtained
from Freighter after the player signs the escrow transfer.

**Request body**
```json
{
  "playerPublicKey": "GAAZI4...",
  "amountXlm": "10.0",
  "prediction": 4,
  "signedXdr": "AAAAAgAAAA..."
}
```

| Field             | Type    | Constraints                  |
|-------------------|---------|------------------------------|
| `playerPublicKey` | string  | 56-char Stellar public key   |
| `amountXlm`       | string  | 1 – 1000 XLM, 7 decimal max  |
| `prediction`      | integer | 1 – 6                        |
| `signedXdr`       | string  | Base64 signed transaction XDR|

**Response 201**
```json
{
  "betId": "3f8a2c10-...",
  "transactionHash": "a1b2c3...",
  "status": "PENDING",
  "message": "Bet placed successfully. Waiting for resolution."
}
```

**Errors**
| Status | Code           | Description                          |
|--------|----------------|--------------------------------------|
| 400    | —              | Validation failed (Zod error detail) |
| 422    | `TX_FAILED`    | Stellar transaction rejected         |
| 429    | —              | Rate limit exceeded                  |

---

### `GET /game/history`

Fetch paginated bet history.

**Query params**
| Param             | Type   | Default | Description                          |
|-------------------|--------|---------|--------------------------------------|
| `playerPublicKey` | string | —       | Filter by player                     |
| `gameType`        | string | —       | `DICE` \| `COIN_FLIP` \| `SLOTS`     |
| `status`          | string | —       | `PENDING` \| `WON` \| `LOST` etc.   |
| `limit`           | number | 20      | 1 – 100                              |
| `offset`          | number | 0       | Pagination offset                    |

**Response 200**
```json
{
  "data": [
    {
      "id": "3f8a2c10-...",
      "player_public_key": "GAAZI4...",
      "game_type": "DICE",
      "prediction": 4,
      "outcome": 4,
      "amount_xlm": "10.0000000",
      "payout_xlm": "49.0000000",
      "status": "WON",
      "transaction_hash": "a1b2c3...",
      "created_at": "2026-01-01T12:00:00.000Z",
      "resolved_at": "2026-01-01T12:00:05.000Z"
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

---

## Rate Limiting

All endpoints: **100 requests / 60 seconds** per IP.
Response headers: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`.
