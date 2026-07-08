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

Each on-chain call below requires the player's signature (`require_auth`), so
the flow is four round-trips rather than one — the API never holds a key
capable of moving funds:

```
1. Player opens Dice page, selects prediction (1–6) and amount
2. Frontend calls POST /api/games/dice/place   → API builds core.place_bet()
   XDR, stores a 'building' row in dice_bets, returns { placeXdr, betDbId }
3. Player signs placeXdr with Freighter
4. Frontend calls POST /api/games/dice/roll    → API submits placeXdr,
   reads the on-chain bet_id from the return value, builds dice.roll_dice()
   XDR (with a fresh random seed), returns { rollXdr }
5. Player signs rollXdr with Freighter
6. Frontend calls POST /api/games/dice/resolve → API submits rollXdr,
   reads { outcome, won } from the DiceRoll return value, builds
   dice.claim_winnings() (won) or dice.resolve_lost_bet() (lost) XDR
7. Player signs the resolve XDR with Freighter
8. Frontend calls POST /api/games/dice/finalize → API submits it,
   lumabet_dice calls lumabet_core.resolve_bet() which pays the winner,
   API records the final status + payout in dice_bets
9. Frontend polls /api/games/dice/history or /api/games/dice/status/:address
```

Note: `/game/dice` and `/game/dice/prepare` (in `src/routes/game.ts`) predate
this integration — they build a plain payment transaction rather than
invoking the real contracts and never resolve the bet. They are kept for
backward compatibility with the existing frontend `Dice` page but should be
migrated to the flow above.

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
