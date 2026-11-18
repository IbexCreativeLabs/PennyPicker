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

**Seeded Chipnet book (2026-11-18, PP Trader B, so judges can trade immediately):**

| Order | Transaction |
| --- | --- |
| Ask 0.001 BCH at +10 BPS | `46414cdd37bc2de1e68482b04e4fb62611a52e480768caaf0a7cff7372f2f349` |
| Ask 0.001 BCH at +25 BPS | `8656868d575c76b7a10d37fcce809103defcc6793aa88ec4446ebfe8cf555661` |
| Ask 0.001 BCH at +50 BPS | `5de6040494e4bfd8d48f8bb394aed2974373c3bb1f3dcb7c65dd484198278015` |
| Bid 30.00 PUSD at −10 BPS | `91410e7bdc11671e9bd9db5374b4dc1ea92bacc6eeae5b4017d293e742e078bd` |
| Bid 30.00 PUSD at −25 BPS | `66f703e261e67e1d59acb715c7e273ae23b5614751f7bbd79cb494a6007b384e` |
| Bid 30.00 PUSD at −50 BPS | `ef8d872eb396e4ff84413eca12a26e11c4d75b5d60241f927ac27f4beb4ee882` |

Together with the earlier +20 BPS ask, the book shows a 20 BPS spread around the oracle price.

**Two-wallet trade recorded on the public site (2026-11-18):** PP Trader A bought 0.001 BCH from Trader B's +10 BPS
ask for 0.21 PUSD, bundling the newest oracles.cash message (#1931898). The fill is
`74966ac56d7fed89db2ff4e21f912f18e83541fdd6ba6efcd55099f341a71de7`. The recording is
`pennypicker_two_wallet_trade.gif` (kept outside the repo).

**Contention handling verified on Chipnet (2026-11-18):** Trader A signed a sell into the −10 BPS bid but held it.
A competing fill `6900ec50ed4bbd1049842b45f2dc96941f52f5048c6170a9e9bbbb473f9bfe2a` then spent the oracle first.
- **Broadcasting the held transaction:** rejected with "An input was already spent… Nothing was broadcast", and the
  panel offered **Rebuild with the latest state**.
- **After Rebuild:** the trade was re-priced at the newer oracles.cash message #1931922, then signed and accepted:
  `1f0ff030c55407152db8e18d228c93c0c69cdcd7625186d3ae95d7393b52a57f`.
- **Bug found and fixed:** the vendored `@unspent/wallet` broadcast (`sendRawTransaction(hex, false)`) fired the
  request without awaiting it and always reported success. A losing double spend therefore showed "Broadcast accepted"
  (`60e72307…` never reached the network). It now waits for the server's verdict. TxFlow also flags a transaction the
  server stops knowing after about a minute.

**Token metadata (BCMR), 2026-11-18:**
- The registry is served at `https://pennypicker.pages.dev/.well-known/bitcoin-cash-metadata-registry.json`
  (sha256 `468ca6eba7ad1eae55b90a3793f50cb0398f99dc0c2df44f41dce90af5b41a2b`): name PennyPickerUSD, ticker PUSD,
  2 decimals, a PNG icon.
- It was published in PUSD's identity chain from Cashonize (operator wallet, Wallet tools → Identities → publish
  metadata): `2cbeb3483efa771d4ab7206b3482b328587dfdb5f4557ce1d61af0653c4a40bf`.
- `bcmr-chipnet.paytaca.com`, the indexer Cashonize uses on Chipnet, returns the name immediately.
- Cashonize refuses app (WalletConnect) requests to spend identity coins by default, so the app's own builder
  (`buildBcmrPublication`, VM-tested) serves other wallets.

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

**Pages** (`packages/app/src/routes/(pp)`; PennyPicker is the whole site, all Vox routes and assets were removed)

| Route | Purpose |
| --- | --- |
| `/` | Exchange: market header, orderbook, limit-order and trade-now panels, my orders, activity. With ParyonUSD selected: the live mainnet market (real money, 25 PUSD cap) |
| `/token` | Selected stablecoin's details (PennyPickerUSD or ParyonUSD), your balance, market list |
| `/oracle` | Live oracles.cash price, on-chain reference, permissionless update, history |
| `/wallet` | Connect Cashonize (QR, copy, Cashonize-web deep link), balances, **Send PUSD**, UTXO list |
| `/about` | Project description, how it works, liquidation and redemption simulations, disclaimers, Vox fork credit |
| `/admin` | **Admin (password)**: setup and test checklist, market identifiers |
| `/admin/token` | **Admin**: PUSD genesis, identity, BCMR draft, vout-0 self-transfer |
| `/admin/simulator` | **Admin**: the original in-memory simulator |

Header: stablecoin selector (PennyPickerUSD on Chipnet, tradable; ParyonUSD `2469acc5…2544` on mainnet, live with a 25 PUSD cap). Bottom-right **Chat** button opens the Telegram community panel (link set in `deployment.ts` → `COMMUNITY.telegramUrl`). Old `/penny-picker/...` links redirect via `static/_redirects`.

## Mainnet (ParyonUSD): live, trading open on the public site (2026-11-18)

Approved by the owner. Done from a local dev build with `VITE_PENNYPICKER_MAINNET_WRITES=1`, using new
single-address Cashonize mainnet wallets funded by the owner.

| Wallet | Address |
| --- | --- |
| PP Mainnet Maker (oracle operator) | `bitcoincash:qrha2a6sntr3xgu3ay4zendhfeaxns8v7qru2jmsy0` (PKH `efd577509ac7132391e92a2ccdb74e7a69c0ecf0`) |
| PP Mainnet Taker | `bitcoincash:qpm8n7nr2syegnnyf678yqqfsphe837lhsgkllaptd` |

| # | Step | Transaction |
| --- | --- | --- |
| 1 | Mainnet price record created from oracles.cash (207.73), category `f9a9812abc5f8de2847b10945c81a392ff86707f07eff25f091eda27a17503d6` | `95734104aa53ada1642974ea3ea778c00da10bf9c42ef346bc395006693c5473` |
| 2 | Maker ask: 0.0005 BCH at +50 BPS | `650e7000ddcc1a5a43d203b6ff625ad2f09a5228a2a0ac03c377403721117a24` |
| 3 | Taker buys 0.0002 BCH from the ask for 0.05 ParyonUSD (0.0419 rounded up for the maker), bundling oracles.cash price 208.32 | `3bbf492694ed79255b6397b80c9aef3829d0245bbff250e1bb5134f278fb7cc0` |
| 4 | Maker cancels the remainder: 0.00031 BCH + 0.05 ParyonUSD back to the Maker | `c46482bf44c750556e51351cc6f62513d790f594d6addad7f6e04a9d4f4b4c1e` |

Transactions 1 and 2 confirmed in block 977888. After the round trip the Maker holds 0.05 ParyonUSD and the Taker holds 0.95.
**Opened to the public by the owner on 2026-11-18** (`MAINNET_WRITES_COMMITTED = true`): 25 PUSD per-order cap, no keeper.
Checked live after the deploy (build `71ce7ad`):
- The ParyonUSD market shows the order form, the real-money banner and the 25 PUSD cap.
- The book reads "1 announced · 1 fill · 1 canceled".
- There are no console errors.

**Deploy-time cache bug (fixed in `71ce7ad`):**
- While Cloudflare switched to `21a6a1c`, a script not yet propagated was answered with the app shell (200 HTML), and the
  one-year immutable cache rule pinned it. The browser then showed "Failed to fetch dynamically imported module".
- Missing files now return 404 (fallback `404.html`), app files are cached for one day, and the error page repairs the
  cache once and reloads.

## Mainnet version (ParyonUSD), built 2026-11-18

- **Network-aware app.** `network.ts` defines Chipnet and mainnet: address prefix, WalletConnect chain (`bch:bchtest` / `bch:bitcoincash`), explorers, storage namespace. The selected market sets the network. Switching it reloads the market, history and Electrum provider, and only uses a Cashonize session approved for that chain.
- **Same contracts.** ParyonUSD has 2 decimals like PennyPickerUSD, so the order and oracle covenants are unchanged. The builders encode mainnet addresses from `MarketConfig.network`.
- **Safety.**
  - `MAINNET_WRITES_COMMITTED` (`deployment.ts`) gates mainnet signing (in `TxFlow`) and broadcasting (in `chain.ts`). It is on since 2026-11-18.
  - `MAINNET_MAX_ORDER_UNITS = 2500` caps every mainnet order at 25.00 PUSD, enforced by the builder and the form.
  - Mainnet screens show a real-money warning.
- **Deployed since:** the mainnet price record (`MAINNET_DEPLOYMENT.oracleCategory`) was created on 2026-11-18 with owner approval (genesis `95734104…`), followed by a real order, fill and cancel. See the mainnet section above.
- **Verified:**
  - 22 new mainnet checks in the exchange suite: addresses, cap, broadcast switch, and a ParyonUSD genesis, ask, bid and fill verified in the BCH 2025 VM.
  - `scripts/pennypicker-mainnet-check.ts` (read-only) reaches mainnet Electrum and finds ParyonUSD.
  - In Chrome: market switching both ways, and the Chipnet wallet restored after switching back.
  - No mainnet wallet was paired and no mainnet transaction was made.

## Deployment (public demo)

- **Live at https://pennypicker.pages.dev.** Cloudflare Pages builds from GitHub `main` (build `pnpm app:build`, output `docs`) and redeploys on every push. Full steps are in `DEPLOYMENT.md`.
- **Checked by the agent on 2026-11-17 (HTTP only):**
  - Every route returns 200 and the security headers are served.
  - The bundle is stamped with build `5642333`, embeds the WalletConnect project ID, and uses chain `bch:bchtest` with the Chipnet Electrum host `chipnet.imaginary.cash`. The only mainnet strings are libauth's enum names.
  - The Reown allowlist is empty (checked by you), so every origin is allowed.
- **Checked 2026-11-17:** pairing Cashonize from https://pennypicker.pages.dev (origin shown as https, PennyPicker icon), signing and broadcasting there (oracle update `9ee282d6…`). The oracles.cash relay allows cross-origin reads.
- **Committed defaults:** the market identifiers are in `deployment.ts` (PUSD category and operator PKH). The oracle category is discovered on-chain and accepted only if the operator's own address created it.
- **What visitors see:** `/` is the Exchange (no redirect). A first-visit demo notice and a Demo badge appear, and a Chat button sits on every page. `/admin` needs `ADMIN_PASSWORD` (see `DEPLOYMENT.md`).
- **CI:** `pennypicker-ci.yml` runs the tests and the build. The inherited Vox deploy workflows were removed.

## Tests

Run from `packages/app`, using libauth's BCH 2025 VM:

```
pnpm dlx tsx scripts/pennypicker-contracts.test.ts   # 33 covenant checks (incl. a real oracles.cash message and attack cases)
pnpm dlx tsx scripts/pennypicker-exchange.test.ts    # 85 builder checks (signed, chained txs, PUSD genesis + transfer, identity safeguards, error texts, mainnet/ParyonUSD + cap)
pnpm dlx tsx scripts/pennypicker-mechanisms.test.ts  # 9 routing checks
pnpm dlx tsx scripts/pennypicker-identity.test.ts    # 8 authchain/marking checks
```

Read-only mainnet check: `pennypicker-mainnet-check.ts`. Read-only Chipnet helpers: `pennypicker-live-check.ts`, `-balances.ts`, `-utxos-full.ts`, `-oracle-history.ts`, `-verify-trades.ts`, `-wait-confirm.ts`.

The UI has been driven end to end in Chrome by the agent (see the live test table). Type-check (`svelte-check`): 0 errors. The unused Vox apps, packages and contracts were removed on 2026-11-18; the workspace is now `packages/app` and `packages/wallet` (Electrum watch-only wallet from Vox). Internal security review: `SECURITY_REVIEW.md`.

## Known limitations

- **Oracle trust: oracles.cash (General Protocols).** The contract verifies their signature; there is no PennyPicker operator. PUSD is a test token *priced as* 1 USD with no backing.
- **Message choice window.** The chain cannot see the clock, so a taker may pick any signed message newer than the stored one (minutes while the market is active, longer if idle). The app always uses the newest; the UI marks prices older than 15 minutes as stale.
- **Oracle contention.** Every create, fill and update spends the single oracle UTXO, so concurrent users conflict and must rebuild. Unconfirmed chaining works.
- **Order sizing.** An ask's BCH is its size. A bid's PUSD is its size, and its BCH size shown in the UI depends on the current reference.
- **Discovery limits.** It scans the last 300 oracle-history transactions and makes one Electrum call per announced order.
- **Fees.** Estimated at about 1 sat/byte. Order outputs keep a 1,000-sat reserve, and the minimum trade is 5,000 sats.
- **Local state.** Transaction history and config live in localStorage per browser unless set via `VITE_PENNYPICKER_*`.
- **Older helpers.** `orderCommitment.ts` (address helpers) and `market.ts` (admin simulator math) come from earlier designs.
- **No security review.** The covenants have not been independently reviewed.

## External actions required (you)

1. **Pushing:** GitHub credentials are cached in memory (git `credential.helper cache`, 7 days from 2026-11-18). After
   that expires, run `git fetch ibex-backup` once in your terminal so the agent can push again.
2. **Faucet top-ups:** tbch.googol.cash uses a CAPTCHA the agent may not solve.
3. **Mainnet go-live:** needs your approval (`DEPLOYMENT.md` §5).

## Release status (2026-11-18)

- **Done:**
  - Public site: Exchange, Token, Oracle, Wallet and About.
  - Admin area behind a password.
  - Seeded Chipnet book.
  - Real two-wallet trades and the README GIF.
  - Recovery from contention, with real broadcast errors shown.
  - Live ParyonUSD mainnet market (25 PUSD cap, no keeper).
  - Internal security review.
  - Submission write-up (`SUBMISSION.md`) and demo script (`DEMO_SCRIPT.md`).
- **Checked on the live site:**
  - No console errors on any page.
  - No horizontal overflow at 390 px on any page.
  - Stale saved IDs are ignored and removed.
- **Not done (out of scope for the hackathon build):**
  - Mainnet price record and keeper.
  - External audit.
  - Vault contracts for liquidations and redemptions (pricing simulations only).
