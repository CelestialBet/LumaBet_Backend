# LumaBet — System Architecture

## Overview

LumaBet is a decentralized casino built on the Stellar blockchain. All game logic
and fund custody run on Soroban smart contracts. The backend API is a stateless
bridge that provides REST endpoints, persists game history off-chain in PostgreSQL,
and reads on-chain state from Horizon. The React frontend communicates with both.

---

## High-Level Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        USER BROWSER                         │
│                                                             │
│  ┌──────────────┐   ┌─────────────────┐  ┌──────────────┐  │
│  │   React App  │   │ Freighter Wallet│  │ Stellar SDK  │  │
│  │  (apps/web)  │◄──│   Extension     │  │  (in-browser)│  │
│  └──────┬───────┘   └────────┬────────┘  └──────┬───────┘  │
│         │                   │ sign XDR           │          │
└─────────┼───────────────────┼────────────────────┼──────────┘
          │ REST              │                    │
          ▼                   │                    │ RPC/Horizon
┌─────────────────┐           │            ┌───────▼──────────┐
│   Backend API   │           │            │  Stellar Network  │
│  (apps/api)     │───────────┘            │                  │
│  Express + TS   │  submit signed tx      │  ┌────────────┐  │
│                 │───────────────────────►│  │  Soroban   │  │
│  ┌──────────┐   │                        │  │ Contracts  │  │
│  │PostgreSQL│   │◄───────────────────────│  │            │  │
│  │  (bets,  │   │  read on-chain state   │  │ core       │  │
│  │  history)│   │                        │  │ dice       │  │
│  └──────────┘   │                        │  │ rng        │  │
└─────────────────┘                        │  └────────────┘  │
                                           └──────────────────┘
```

---

## Component Responsibilities

### Soroban Contracts (`contracts/`)

| Contract       | Responsibility                                                        |
|----------------|-----------------------------------------------------------------------|
| `lumabet_rng`  | On-chain pseudo-RNG. Mixes ledger sequence, timestamp, and user seed. |
| `lumabet_core` | Betting escrow. Holds XLM, resolves outcomes, pays winners.           |
| `lumabet_dice` | Dice game logic. Calls `lumabet_rng`, returns result to `lumabet_core`.|

**Fund flow:**
```
Player → place_bet() → XLM locked in lumabet_core contract
                            │
               lumabet_dice.roll_dice() calls lumabet_rng
                            │
               lumabet_core.resolve_bet() → pays winner or retains stake
```

### Backend API (`apps/api`)

- Stateless Node.js/Express service
- Validates requests, submits signed XDRs to Stellar
- Stores game history in PostgreSQL for fast queries / leaderboards
- Reads live balances from Horizon REST API
- Does NOT hold private keys (signing happens in browser via Freighter)

### Frontend (`apps/web`)

- React SPA with Vite
- Freighter wallet integration for key management and transaction signing
- Reads game config from shared `@lumabet/config`
- Sends signed transaction XDRs to the API

### Shared Packages

| Package                  | Purpose                                              |
|--------------------------|------------------------------------------------------|
| `@lumabet/types`         | TypeScript interfaces shared across API and web      |
| `@lumabet/config`        | Network constants, game config, env loader           |
| `@lumabet/stellar-client`| Stellar SDK wrappers: balance, submit, sign helpers  |

---

## Data Flow: Placing a Dice Bet

```
1. Player opens Dice page, selects prediction (1–6) and amount
2. Frontend calls POST /game/dice/prepare → API returns unsigned XDR
3. Frontend passes XDR to Freighter → player signs → returns signedXdr
4. Frontend calls POST /game/dice with signedXdr
5. API submits signedXdr to Stellar RPC via stellar-client
6. Soroban: lumabet_core.place_bet() locks XLM
7. Soroban: lumabet_dice.roll_dice() → lumabet_rng.generate_random()
8. Soroban: lumabet_core.resolve_bet() → pays winner
9. API receives tx confirmation, writes bet record to PostgreSQL
10. Frontend polls /game/history or receives WebSocket push (future)
```

---

## Security Model

- **No custodial keys**: the API never holds user private keys. All signing is done
  client-side in Freighter.
- **Escrow on-chain**: user funds are locked in the Soroban contract, not in a
  server-controlled wallet.
- **Admin-only resolution**: `resolve_bet` requires the admin keypair — this will
  be replaced by the dice contract calling core directly once cross-contract auth
  is stable.
- **House edge enforced in-contract**: the 2% house edge is computed and applied
  on-chain, so the API cannot inflate or deflate payouts.
- **RNG transparency**: all RNG inputs (ledger sequence, timestamp, seed) are
  public on-chain. A future upgrade should integrate a VRF oracle for stronger
  unpredictability guarantees.
