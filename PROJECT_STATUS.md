# PennyPicker: project status

_Last updated: 2026-11-16. Hackathon deadline: 2026-11-22._

PennyPicker is an experimental BCH/PUSD orderbook DEX on **BCH Chipnet**. Orders are priced in basis points (BPS)
relative to an on-chain reference price. PUSD is a fixed-supply test token (1,000,000 PUSD, 2 decimals) with no USD
backing and no peg. `PENNYPICKER_PROGRESS.md` is the earlier research log.

## Confirmed on Chipnet

The user performed these steps through Cashonize and the app. All are confirmed, and the IDs were checked against Electrum.

| Step | Transaction | Result |
| --- | --- | --- |
| Wallet | — | `bchtest:qq3gfs2492tlz2nckgpq6wn28fcd80lucvlxe0nrf0` (PKH `2284c1552a97f12a78b2020d3a6a3a70d3bffcc3`) |
| Self-transfer #1 | `b9d9ef3c2cd4ad75354119824c79b068501f3f5f4131b4a246274b35d508a2ee` | vout 0 = 516,548 sats (fee 232) |
| **PUSD genesis** | `46db72c8711ccda28de97e924e5edc12a6f5b1f124fc2df83433c4a2156b61e4` | 100,000,000 base units at vout 0 (1,000 sats). No baton, no NFT |
| **PUSD category** | — | `b9d9ef3c2cd4ad75354119824c79b068501f3f5f4131b4a246274b35d508a2ee` |
| Self-transfer #2 | `03f6c31a05b86b4278991ad9429049283f8a2bb84c27a4fc3d9aae898cd0a602` | vout 0 = 515,057 sats, reserved for oracle genesis |

**Not yet done:** oracle genesis, orders, trades, cancels and oracle updates. The BCMR draft is local only and unpublished.

**Next on-chain step:** oracle genesis on `/penny-picker/oracle`, at 500.00 PUSD per BCH.
- A read-only dry run against the real UTXOs spends only `03f6c31a…:0`.
- It sends 1,000 sats plus the mutable oracle NFT to `bchtest:rd8cuc0a5yrky7en2en9yqq6mwup6jrs3c653xecpvqxydwsxzaa6pgp8ctn6`.
- It returns 513,747 sats of change, with a fee of 310 sats.
- The resulting **oracle category will be `03f6c31a05b86b4278991ad9429049283f8a2bb84c27a4fc3d9aae898cd0a602`**, and the operator PKH will be your wallet's.

## Pricing convention (protocol v2, changed before any oracle or order existed)

- **Pair:** BCH/PUSD. Price = **PUSD per BCH**. The oracle stores it × 1e8 (`500.00` → `50000000000`).
- **Limit price:** `reference × (10000 + BPS) / 10000`.
- **Ask** = sell BCH, with BPS ≥ 0. It escrows BCH and collects PUSD. At +50 BPS with a 500.00 reference, the limit is **502.50**.
- **Bid** = buy BCH, with BPS ≤ 0. It escrows PUSD and collects BCH. At −25 BPS, the limit is **498.75**.
- **Exact settlement in the covenant:** `dUnits × 1e18 + dSat × price × (10000 + BPS) ≥ 0`, with no rounding inside the contract.
  - The app rounds in the maker's favour: an ask taker pays `ceil(...)` PUSD, and a bid taker receives `floor(...)` PUSD.
- **Why the change:** v1 applied BPS to satoshis per PUSD, so "+50 BPS" came out at 497.51 PUSD/BCH. That contradicted the intended "+50 BPS = 502.50" reading.

## Architecture

**Covenants** (`packages/app/src/lib/pennypicker/contracts/*.cash`, cashc 0.11.5)

- **`PennyPickerOracle(operatorPkh)`** holds the single mutable oracle NFT. Its commitment is `price:int64le | timestamp:int32le | sequence:int32le`.
  - `update()` requires the input directly after the oracle to come from the operator's P2PKH address. The wallet signs that input normally, and SIGHASH_ALL covers the new price. The sequence must strictly increase and the timestamp may not go backwards.
  - `read()` lets anyone spend the oracle UTXO if it is recreated unchanged. Superseded prices are therefore spent outputs.
- **`PennyPickerOrder(oracleCat, pusdCat, makerPkh, side, deltaBps)`** gives each order its own P2SH32 address. One UTXO holds the escrow and the proceeds.
  - `fill()` reads the oracle at input 0, continues the order at the same index, and enforces the side and the exact settlement inequality.
  - `cancel()` requires the maker's P2PKH input directly after the order input.
- **Why P2PKH-input authorisation:** it avoids depending on WalletConnect contract-signature placeholders, which Cashonize support could not be verified for. Cashonize already signs P2PKH inputs in practice; the self-transfers and genesis prove it.

**Library** (`packages/app/src/lib/pennypicker/`)

- `contracts.ts`: instantiation, commitments, and integer price math (`limitPrice`, `askFillUnitsDue`, `bidFillUnitsOut`, `parsePrice`, `formatPrice`).
- `exchange.ts`: unsigned builders for oracle genesis/update and order create/fill/cancel.
  - It also handles OP_RETURN announcements (`PPKR | v2 | side | BPS | makerPkh`), token conservation, and the check that a signed transaction matches its preview.
- `chain.ts`: Electrum I/O.
  - Discovery scans the oracle address history, since every create, fill and update touches the oracle. From that it derives open orders, cancels (an order UTXO is gone; fills always recreate it), fills and oracle price history.
- `mechanisms.ts`: liquidation pricing through the bids and redemption pricing through the asks. These are simulations.
- `ui/session.svelte.ts`: shared app state for wallet session, config, oracle, balances, discovery and setup progress. **Every status is derived from Electrum data.**
- `ui/TxFlow.svelte`: preview, then Cashonize sign (`broadcast: false`), then signed-vs-preview check, then explicit Broadcast, then confirmation polling with an explorer link.
- `ui/theme.css`: PennyPicker design tokens and primitives, scoped under `.pp` with light and dark themes.

**Pages** (`/penny-picker/*`, using their own shell; the root layout skips the Vox chrome for these routes)

| Route | Purpose |
| --- | --- |
| `/penny-picker` | Overview: reference price, setup and test checklist, pricing explainer, market identifiers |
| `/penny-picker/exchange` | Market header, orderbook (asks / reference / bids), limit-order and trade-now panels, my orders, activity |
| `/penny-picker/oracle` | Current reference, freshness, identity, how the oracle works, genesis and update forms, price history |
| `/penny-picker/token` | PUSD info, wallet balances, genesis status, BCMR draft, vout-0 self-transfer tool |
| `/penny-picker/mechanisms` | Liquidation and redemption simulations (live book when available) |
| `/penny-picker/wallet` | Connect or disconnect Cashonize (QR pairing), balances, UTXO list |
| `/penny-picker/simulator` | The original in-memory simulator (legacy sats-per-PUSD convention) |

## Deployment (public demo)

- **Target:** Cloudflare Pages, deployed from GitHub with auto-deploy on push to `main`. The site is static (`docs/`), plus one Pages Function, `functions/api/feedback.js`, that turns feedback into GitHub issues. Full steps are in `DEPLOYMENT.md`.
- **Verified locally:** the production build and `wrangler pages dev`, covering every route, the response headers, and every validation path of the feedback function.
- **Not done yet: the public URL is not live.** It needs the Cloudflare project to be created, the WalletConnect project ID set as a build variable, and, if your Reown allowlist is not empty, the domain added. A GitHub token for the feedback function is optional.
- **Committed defaults:** the market identifiers are in `deployment.ts` (PUSD category and operator PKH). The oracle category is discovered on-chain and accepted only if the operator's own address created it.
- **What visitors see:** `/` redirects to `/penny-picker` (the Vox list is still available at `/?vox`). A first-visit demo notice and a Demo badge appear, and a Feedback button sits on every page.
- **CI:** the inherited Vox deploy workflows (GitHub Pages to `vox.cash` and `unspent.dev`) were removed. `pennypicker-ci.yml` runs the tests and the build.

## Tests

Run from `packages/app`, using libauth's BCH 2025 VM:

```
pnpm dlx tsx scripts/pennypicker-contracts.test.ts   # 23 covenant checks
pnpm dlx tsx scripts/pennypicker-exchange.test.ts    # 22 builder checks (signed, chained txs)
pnpm dlx tsx scripts/pennypicker-mechanisms.test.ts  # 9 routing checks
```

The UI was checked by type-checking (no errors in PennyPicker files; 122 pre-existing Vox errors remain) and by
server-rendering every page, including with the real wallet's Chipnet UTXOs loaded. It has **not** been clicked
through in a browser by the agent.

## Known limitations

- **The oracle is operator-attested.** It does not check prices against any market, and the operator key is trusted. The chain cannot enforce freshness; the UI marks a price stale after 15 minutes.
- **Oracle contention.** Every create, fill and update spends the single oracle UTXO, so concurrent users conflict and must rebuild. Unconfirmed chaining works.
- **Order sizing.** An ask's BCH is its size. A bid's PUSD is its size, and its BCH size shown in the UI depends on the current reference.
- **Discovery limits.** It scans the last 300 oracle-history transactions and makes one Electrum call per announced order.
- **Fees.** Estimated at about 1 sat/byte. Order outputs keep a 1,000-sat reserve, and the minimum trade is 5,000 sats.
- **Local state.** Transaction history and config live in localStorage per browser unless set via `VITE_PENNYPICKER_*`.
- **Legacy modules.** `orderCommitment.ts` (only `makerPkhFromChipnetAddress` is still used), `orderbookIndex.ts`, `electrumOrderbook.ts`, `orderLifecycle.ts`, `executionOracle.ts` and `market.ts` (simulator) belong to earlier designs.
- **No security review.** The covenants have not been independently reviewed.

## External actions required (you)

1. **Oracle genesis:** `/penny-picker/oracle` → price `500.00` → Review → Sign in Cashonize → Broadcast. Then wait for confirmation.
2. Optionally put the identifiers in `packages/app/.env` (`VITE_PENNYPICKER_PUSD_CATEGORY`, `…_ORACLE_CATEGORY`, `…_ORACLE_OPERATOR_PKH`).
3. **Push commits:** `git push ibex-backup main` from your terminal. This shell has no GitHub credentials.
4. **Testing:** place an ask and a bid. Fill them from a second Cashonize wallet; fund it from a faucet and send it some PUSD. Cancel an order, publish an oracle update, and check that limit prices re-price.

## Remaining tasks

- Run and fix the first live oracle genesis, order, fill, cancel and update. Cashonize behaviour with contract inputs in `sourceOutputs` is the main unknown.
- Optionally add a PUSD transfer helper, to seed a second test wallet from the UI.
- Polish after live testing: empty states, mobile tuning, and a price chart from the oracle history.
