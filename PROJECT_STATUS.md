# PennyPicker: project status

_Last updated: 2026-11-17 (evening). Hackathon deadline: 2026-11-22._

**Public demo: https://pennypicker.pages.dev** (Cloudflare Pages, auto-deploys from `main`).

PennyPicker is an experimental BCH/PUSD orderbook DEX on **BCH Chipnet**. Orders are priced in basis points (BPS)
relative to an on-chain reference price. PUSD is a fixed-supply test token (1,000,000 PUSD, 2 decimals) with no USD
backing and no peg. `PENNYPICKER_PROGRESS.md` is the earlier research log.

## Live market on Chipnet (2026-11-17)

All three wallets are Cashonize single-address **Chipnet development wallets** in the VM's Chrome (seed phrases stay in Cashonize; never exported).

| Role | Address |
| --- | --- |
| **PP Operator** (PUSD issuer, oracle creator) | `bchtest:qz6fyv7h46g24nwlqmhua23hqumgj2zgcc0w05m3sx` (PKH `b49233d7ae90aacddf06efceaa370736892848c6`) |
| PP Trader A | `bchtest:qze7r468d3qk2wnvzt7afwm2g7wzhgv0fgel4t7e50` |
| PP Trader B | `bchtest:qrxy22p45mzt6tg0e3hjqmy8sz6jgqzjmvw89lgp4t` |

| Identifier | Value |
| --- | --- |
| **PUSD category** | `74167994a2d8e1e57188bae9a42035678e3526a1d8650ced756b2ffa4c078ab3` (1,000,000.00, 2 decimals, no baton) |
| PUSD genesis | `9a1a960107d5de533a68659bd3b97b175f548c1d483beb7c7ff285b560316aba`: **output 0 = BCH-only identity, output 1 = supply** (no separation step needed) |
| **Oracle category (v4, oracles.cash)** | `adcf011756ad2726f8521c371ea950ae293fb1a1e6507bfdc13cbe2b2d4f74b5` (v3 operator-typed oracle `88e2a9ee…` retired) |
| Oracle genesis | `a08a39c3d9d8df4274c79ed33864247e118ff2b727edc46981f7eddb3d7a60dc` (500.00, seq 1, block 335268) |

**Oracle v4 (oracles.cash BCH/USD), live:**

| Step | Transaction | Verified result |
| --- | --- | --- |
| Oracle genesis (210.99, message #1930547) | `34533fc4635527016456e3965b1cc31e5a7037c0a4537282480feaf57a6d0e27` | category `adcf011756ad2726f8521c371ea950ae293fb1a1e6507bfdc13cbe2b2d4f74b5` |
| Operator ask, sell 0.002 BCH at +20 BPS, **carries oracles.cash message #1930549** | `e5f61b3aa73ac78d0a92ee7cc15fe2553973a2feb7993c5f34ff85746d83c030` | GP signature checked on-chain; block 335332 |
| **Trader B buys 0.001 BCH, carries message #1930551 (211.10)** | `bc35fd555f665b194df906b1493b618c2c45080498f5db5a80a0d603fad91036` | price read from output 0: 22e18 − 1e5·211.10e8·10020 ≥ 0 ✓ (0.21152 → 0.22 PUSD). Signed by a wallet that did not create the oracle |

| **Permissionless price update from the public site** (Trader B, paired from https://pennypicker.pages.dev) | `9ee282d6…` | 211.10 → 211.80, message #1930566 |

`scripts/pennypicker-verify-oracle-tx.ts <txid>` decodes the message a transaction carried and re-checks the General Protocols signature.

**Earlier end-to-end test on oracle v3 (operator-typed price, retired), all signed in Cashonize, broadcast from the app and checked against Chipnet** (types: real signed and broadcast Chipnet transactions):

| # | Step | Transaction | Verified result |
| --- | --- | --- | --- |
| 1 | Operator sends 1,000 PUSD to A and to B | `fa8865f4…` | identity output `9a1a9601…:0` untouched (flagged "PUSD identity" in the UI) |
| 2 | A: ask, sell 0.002 BCH at +50 BPS (502.50) | `b399b57669165730286fd34a17ee727b6f2c3857899d11f1d8a36ee980f06040` | block 335278 |
| 3 | **B buys 0.001 BCH from A's ask** | `ebfecc0823b8bdb5fa42402e1f92aae7143c4236fd6c5e74aa7384b9f1dc385b` | order 201,000→101,000 sats, 0→51 PUSD units. 51e18 − 1e5·500e8·10050 ≥ 0 ✓ (0.5025 rounded up for the maker). Block 335278 |
| 4 | B: bid 0.25 PUSD at −50 BPS (497.50) | `c462779107098006a38eab1fa4587b847b16769920f6450e79191ef72c15e583` | block 335278 |
| 5 | **A sells 0.0002 BCH into B's bid** | `e3098a63bb4163ef1d8aaa11d419f073b14e0ccda3bac4307ad46b730a7b83ae` | order +20,000 sats, 25→16 units. −9e18 + 2e4·500e8·9950 ≥ 0 ✓ (0.0995 rounded down for the maker). Block 335278 |
| 6 | A cancels ask remainder | `900dc99c…d4132f3` | A gets 0.001 BCH + 0.51 PUSD back; A shows 1,000.60 PUSD |
| 7 | B cancels bid remainder | `243d498e…356773b` | B gets 20,000 sats bought + 0.16 PUSD |
| 8 | Operator oracle update 500.00 → 505.00 | `f48c14b7…b100ef` | seq #2; open-order limits re-price (+50 BPS → 507.53) |

Earlier v2 tests (retired market, operator `qq3gfs…nrf0` whose wallet is not available): first ask `50e420e3…` and cancel `60bbc9ed…`.
The v2 PUSD (`b9d9ef3c…`) and oracle (`03f6c31a…`) still exist on Chipnet but the app no longer uses them.

**Testing two wallets in one browser:** Cashonize WalletConnect sessions belong to the active wallet, so switching wallets ends the other session.
Use one app origin per wallet (`http://127.0.0.1:5173` and `http://localhost:5173` have separate storage), switch the Cashonize wallet, then
**Wallet → Connect → "Open in Cashonize web"** (deep link `https://cashonize.com/?uri=…`) and approve. On two devices this is not needed.

## Pricing convention (protocol v2, changed before any oracle or order existed)

- **Pair:** BCH/PUSD. Price = **PUSD per BCH** = the oracles.cash **BCH/USD** price with 1 PUSD treated as 1 USD (PUSD stands in for a USD stablecoin, per the project pitch). The oracle stores it × 1e8 (`210.99` → `21099000000`).
- **Limit price:** `reference × (10000 + BPS) / 10000`.
- **Ask** = sell BCH, with BPS ≥ 0. It escrows BCH and collects PUSD. At +50 BPS with a 500.00 reference, the limit is **502.50**.
- **Bid** = buy BCH, with BPS ≤ 0. It escrows PUSD and collects BCH. At −25 BPS, the limit is **498.75**.
- **Exact settlement in the covenant:** `dUnits × 1e18 + dSat × price × (10000 + BPS) ≥ 0`, with no rounding inside the contract.
  - The app rounds in the maker's favour: an ask taker pays `ceil(...)` PUSD, and a bid taker receives `floor(...)` PUSD.
- **Why the change:** v1 applied BPS to satoshis per PUSD, so "+50 BPS" came out at 497.51 PUSD/BCH. That contradicted the intended "+50 BPS = 502.50" reading.

## Architecture

**Covenants** (`packages/app/src/lib/pennypicker/contracts/*.cash`, cashc 0.11.5)

- **`PennyPickerOracle(operatorPkh, oraclePublicKey, priceUnitsPerWhole)`** (oracle v4) holds the single mutable oracle NFT, commitment `price:int64le (×1e8) | timestamp:int32le | sequence:int32le`.
  - **The price comes from oracles.cash.** `oraclePublicKey` is General Protocols' BCH/USD oracle `02d09db0…2818`, with prices in cents (`priceUnitsPerWhole` = 100).
  - **`update(sig, message)` is permissionless.** It checks the signature with `OP_CHECKDATASIG` (Schnorr over sha256 of the 16-byte message `timestamp | messageSequence | dataSequence | price`).
    - It requires a price message (positive data sequence) whose message sequence is greater than the stored one.
    - It writes exactly `price × 1e8 / 100 | timestamp | sequence`. Nobody can type a price.
  - **`read()`** lets anyone spend the state if it is recreated unchanged. Superseded states are spent outputs and can never be reused.
  - `operatorPkh` only names the wallet that created the oracle (one contract address per creator). It grants no rights.
  - **Why an on-chain record, not raw signed messages:** resting orders would otherwise let a taker attach any old signed message and pick a favourable price. The script cannot see the clock, but it can refuse anything older than the stored sequence.
- **`PennyPickerOrder(oracleCat, pusdCat, makerPkh, side, deltaBps)`** gives each order its own P2SH32 address. One UTXO holds the escrow and the proceeds.
  - `fill()` requires the oracle category at input 0 and output 0. It **reads the price from output 0**, so a fill can carry a newer oracles.cash message and settle at it in the same transaction. It continues the order at the same index and enforces the side and the exact settlement inequality.
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
  - `ui/txErrors.ts` turns failures into plain language: declined signature, ended session, slow wallet, spent input (oracle contention), covenant rejection, low fee, network.
- `buildPusdTransfer` (in `exchange.ts`) sends PUSD to up to 20 Chipnet addresses and rejects mainnet addresses.
  - Before oracle genesis, it never spends the operator's confirmed vout-0 UTXO that is reserved for that genesis.
- **Token identity safeguards** (`identity.ts`):
  - The session resolves the PUSD authchain head from Chipnet on every wallet refresh and flags that UTXO (`identityOf`).
  - The selection helpers skip it, and `utxoToInput` refuses to spend it. Only `buildIdentitySeparation` may spend it, and that builder returns it at output 0 to the owner's address.
  - If the authchain can't be resolved, every output-0 wallet coin is held back (fails closed).
- A red **Chipnet offline** banner, with a Retry button, appears when Electrum is unreachable.
- `ui/theme.css`: PennyPicker design tokens and primitives, scoped under `.pp` with light and dark themes.

**Pages** (`/penny-picker/*`, using their own shell; the root layout skips the Vox chrome for these routes)

| Route | Purpose |
| --- | --- |
| `/penny-picker` | Overview: reference price, setup and test checklist, pricing explainer, market identifiers |
| `/penny-picker/exchange` | Market header, orderbook (asks / reference / bids), limit-order and trade-now panels, my orders, activity |
| `/penny-picker/oracle` | Current reference, freshness, identity, how the oracle works, genesis and update forms, price history |
| `/penny-picker/token` | PUSD info, wallet balances, genesis status, BCMR draft, vout-0 self-transfer tool |
| `/penny-picker/mechanisms` | Liquidation and redemption simulations (live book when available) |
| `/penny-picker/wallet` | Connect or disconnect Cashonize (QR pairing), token address (copy), balances, **Send PUSD** to teammates, UTXO list |
| `/penny-picker/simulator` | The original in-memory simulator (legacy sats-per-PUSD convention) |

## Deployment (public demo)

- **Live at https://pennypicker.pages.dev.** Cloudflare Pages builds from GitHub `main` (build `pnpm app:build`, output `docs`) and redeploys on every push. Full steps are in `DEPLOYMENT.md`.
- **Checked by the agent on 2026-11-17 (HTTP only):**
  - Every route returns 200 and the security headers are served.
  - The bundle is stamped with build `5642333`, embeds the WalletConnect project ID, and uses chain `bch:bchtest` with the Chipnet Electrum host `chipnet.imaginary.cash`. The only mainnet strings are libauth's enum names.
  - `/api/feedback` is deployed and answers `not-configured`. No GitHub token is set yet, so testers get the copy-report fallback.
  - The Reown allowlist is empty (checked by you), so every origin is allowed.
- **Checked 2026-11-17:** pairing Cashonize from https://pennypicker.pages.dev (origin shown as https, PennyPicker icon), signing and broadcasting there (oracle update `9ee282d6…`). The oracles.cash relay allows cross-origin reads.
- **Committed defaults:** the market identifiers are in `deployment.ts` (PUSD category and operator PKH). The oracle category is discovered on-chain and accepted only if the operator's own address created it.
- **What visitors see:** `/` redirects to `/penny-picker` (the Vox list is still at `/?vox`). A first-visit demo notice and a Demo badge appear, and a Feedback button sits on every page.
- **CI:** `pennypicker-ci.yml` runs the tests and the build. The inherited Vox deploy workflows were removed.

## Tests

Run from `packages/app`, using libauth's BCH 2025 VM:

```
pnpm dlx tsx scripts/pennypicker-contracts.test.ts   # 28 covenant checks (incl. a real oracles.cash message)
pnpm dlx tsx scripts/pennypicker-exchange.test.ts    # 63 builder checks (signed, chained txs, PUSD genesis + transfer, identity safeguards, error texts)
pnpm dlx tsx scripts/pennypicker-mechanisms.test.ts  # 9 routing checks
pnpm dlx tsx scripts/pennypicker-identity.test.ts    # 8 authchain/marking checks
```

Read-only Chipnet helpers: `pennypicker-live-check.ts`, `-balances.ts`, `-utxos-full.ts`, `-oracle-history.ts`, `-verify-trades.ts`, `-wait-confirm.ts`.

The UI has been driven end to end in Chrome by the agent (see the live test table). Type-check: no errors in PennyPicker files; 121 legacy Vox errors remain.

## Known limitations

- **Oracle trust: oracles.cash (General Protocols).** The contract verifies their signature; there is no PennyPicker operator. PUSD is a test token *priced as* 1 USD with no backing.
- **Message choice window.** The chain cannot see the clock, so a taker may pick any signed message newer than the stored one (minutes while the market is active, longer if idle). The app always uses the newest; the UI marks prices older than 15 minutes as stale.
- **Oracle contention.** Every create, fill and update spends the single oracle UTXO, so concurrent users conflict and must rebuild. Unconfirmed chaining works.
- **Order sizing.** An ask's BCH is its size. A bid's PUSD is its size, and its BCH size shown in the UI depends on the current reference.
- **Discovery limits.** It scans the last 300 oracle-history transactions and makes one Electrum call per announced order.
- **Fees.** Estimated at about 1 sat/byte. Order outputs keep a 1,000-sat reserve, and the minimum trade is 5,000 sats.
- **Local state.** Transaction history and config live in localStorage per browser unless set via `VITE_PENNYPICKER_*`.
- **Legacy modules.** `orderCommitment.ts` (only `makerPkhFromChipnetAddress` is still used), `orderbookIndex.ts`, `electrumOrderbook.ts`, `orderLifecycle.ts`, `executionOracle.ts` and `market.ts` (simulator) belong to earlier designs.
- **No security review.** The covenants have not been independently reviewed.

## External actions required (you)

1. **Push commits:** `git push ibex-backup main` from your terminal. This shell has no GitHub credentials. Each push redeploys the public site.
2. Faucet top-ups (tbch.googol.cash uses a CAPTCHA the agent may not solve).

## Remaining tasks

- ~~Live oracle genesis, order, fill, cancel and update~~ (done, see table above; Cashonize signs contract inputs fine).
- ~~Mobile pass~~ (all pages checked at 390 px, no horizontal overflow). Optional: price chart from oracle history; a BCMR file for the v3 PUSD category.
