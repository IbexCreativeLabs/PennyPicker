# PennyPicker: project status

_Last updated: 2026-11-19 (night). Hackathon deadline: 2026-11-22._

**Public demo: https://pennypicker.pages.dev** (Cloudflare Pages, auto-deploys from `main`).

PennyPicker is an experimental BCH/stablecoin orderbook DEX on Bitcoin Cash. Orders are priced in basis points (BPS)
relative to the oracles.cash BCH/USD price. Two markets: **PennyPickerUSD (PPUSD)** on Chipnet, a fixed-supply test
token (1,000,000 PPUSD, 2 decimals) with no backing, and **ParyonUSD (PUSD)** on mainnet (real money, capped).
The test token was called PUSD until 2026-11-19; older notes below still use that name. `PENNYPICKER_PROGRESS.md` is
the earlier research log.

## Final changes before handover (2026-11-19, night)

- **Brand:** new steamroller logo for the favicon, app icons, header and the PPUSD token icon. Light and dark themes
  use its colours (amber `#FDA60D`, yellow `#FDD045`, charcoal `#1E1B1D`). ParyonUSD shows its official icon
  (`https://paryonusd.com/logo.svg`, from its on-chain metadata). The Exchange hero reads "Limit orders that move with
  the price", with a static logo (no animation, no buttons); "How it works" is a button in the demo notice. The BPS
  diagram appears only when the book has orders, and an empty book shows "No orders yet".
- **Cleanup:** removed unused modules from earlier designs (`market.ts`, `orderCommitment.ts`, `oracle.ts`,
  `pusdGenesis.ts`, `bcmrDraft.ts`) and unused session state. Fixed: a market reload finishing after a market switch
  could show the previous market's data; a late WalletConnect restore never loaded balances; overlapping HD address
  scans; the market menu did not close on an outside click or Escape.
- **Design pass:** white page, borders made transparent, layered shadows, buttons shrink on press, visible focus rings,
  eased motion, no all-caps labels or eyebrows, `text-wrap: balance` on titles, tabular numbers, the market menu grows
  from its button, scrollers fade at the edge on phones.
- **Ticker:** the Chipnet test token is now **PPUSD** (ParyonUSD keeps PUSD). The UI and transaction summaries use
  each market's own symbol. The registry (`/.well-known/bitcoin-cash-metadata-registry.json`) has a new revision with
  the ticker and icon.
- **Live data only while shown:** no Refresh button or "auto-updating" label on the Exchange. The book is checked every
  5 s only while the Exchange or Oracle page is open in a visible tab; balances every 30 s while the Exchange, Wallet
  or Token page is open; the oracles.cash price every 20 s while the tab is visible.
- **About:** Overview, How it works and Try it are one short page (`/about`); the liquidation/redemption simulations
  are removed (page, component, maths and their test). Old links redirect to `/about`.
- **WizardConnect, whole HD wallet:** the app scans every shared BIP44 path (receive, change) with a gap limit of 20,
  shows the total of all used addresses, funds trades from any of them and asks the wallet to sign each input with
  its own path. Change, proceeds and the maker key of new orders use receive/0, so orders are found again on every
  device; a cancel is authorised by a coin on receive/0 (the app explains what to do if there is none). The Wallet
  page lists the number of addresses in use and which address holds each coin; key hash, role and the "trading
  address" note are gone; the header shows balances only.
- **Fixes:** a stale WalletConnect session no longer blocks restoring a stored WizardConnect session; an order
  re-announced at the same terms after a cancel is no longer counted as a fill.
- **Verified on Chipnet with the "PP Wizard HD" wallet:** moved 0.0006 tBCH to its receive/1 inside Cashonize
  (`a421c173dc1c…`); the app then found 3 used addresses, placed an ask funded from receive/1 over WizardConnect
  (`dde2420509276b95a8d7ec5a76406bb8eb9fc3f95fbf83461a98e3cd3a9bc449`) and cancelled it, authorised by the change
  coin on receive/0 (`586b63d552f7edc77a2ea0362df85f71132808eed4f5ef28d20a0726ebc9db9e`).
- **Tests:** contracts 33, exchange 100 (incl. an HD order and cancel spending three addresses, VM-verified), identity
  8, WizardConnect 21; 0 type errors; production build OK.
- **Token metadata republished** from the PP Operator wallet in Cashonize (Identities → publish), registry sha256
  `b5989f27bf0f8b6c7a6e4c2082dabf9e5a479aed51dea4aea21879854c4c8616`:
  `60313792d3c4ba225bc76b9eb8387d9875bf72b7a9c93e9b5c20b207c5077aea`. `bcmr-chipnet.paytaca.com` returned ticker
  PPUSD and the new icon straight away.
- **Live check after deploy (`4c9c404`):** all pages 200, old About links 301 to `/about`, new icons and registry
  served, no console errors on fresh loads.

## Live re-check (2026-11-19, evening)

- **HTTP:** all 9 pages, the token registry, icons and manifest return 200; old links redirect (`/token`, `/oracle`,
  `/admin`, `/penny-picker/…`); missing files return 404; security headers present.
- **Browser, both markets:** every page renders with no console errors after a fresh load; only the intended real-money
  warnings on mainnet; the real mainnet fill shows under Market fills.
- **Fixed:** the market header shifted by a pixel every few seconds (the refresh label and the freshness age changed
  width, and the button flipped to "Refreshing…" on background updates). The label now reads "Auto-updating", or
  "Updated Xs ago" once data is over 10 s old; widths are fixed. Measured: one layout over 35 s.
- **Fixed:** the liquidation simulation showed "the book can't absorb the full debt" by default. Its default vault (0.25 BCH
  for 110 PUSD) assumed BCH at $500, so it was insolvent at today's price, and it used the thin live test book. It now
  sizes the vault from the live price (100 PUSD at a 130% ratio) and uses the illustrative book by default, with a
  checkbox for the live book.
- **External:** the WizardConnect relay `relay.riften.net` is currently unreachable (IPv4 and IPv6); the second relay,
  `relay.cauldron.quest`, works, so pairing still succeeds. The failed relay only logs console errors while a
  WizardConnect session is open.
- **External:** bchexplorer.cash answers scripted requests with 403 but opens normally in a browser.

## Community feedback pass (2026-11-19)

Feedback from first-time visitors of the public site, evaluated against the code. Commits `6185b0b` and `9a548cf`.

| # | Feedback | Decision | What changed |
| --- | --- | --- | --- |
| 1 | The BPS idea should be obvious at once | **Done** | Exchange hero: "Trade BCH against the live oracle price", one sentence on BPS (100 BPS = 1%), and a live diagram (`BpsScale.svelte`) placing the real bids, asks and the order being drafted around the oracle price, with prices on the axis |
| 2 | The first ~15 s look broken | **Done, root cause fixed** | Startup waited for the WalletConnect session restore, which asks Cashonize for its address, before loading any market data. The price and book now load straight away, with the wallet in parallel; in a test where WalletConnect stalls, the book appeared in ~3 s instead of never. Skeleton rows and "Loading…" texts replace "—", "No asks" and "No reference price yet" until data has arrived |
| 3 | Explain the floating order book | **Done** | Heading "Floating order book" and one line: orders are priced relative to the live reference price, so their absolute price moves with the oracle |
| 4 | Review modal not noticeable | **Done** | The review was an inline panel above the book, off-screen after clicking the button. `TxFlow` is now a centered modal with a backdrop, page scroll lock and focus; Esc closes it except while signing or broadcasting. The transaction logic is unchanged |
| 5 | Wallet balance top right | **Done** | The header pill shows the connected wallet's real BCH and PUSD balances and the address (balances only after the wallet query returns; the address is hidden on phones) |
| 6 | Auto-refresh best bid/ask | **Done** | A read-only poll every 5 s makes one Electrum request (oracle-address history). Every announcement, fill and price update touches that address, so the book reloads only when it changed, plus every 60 s for cancels. Wallet balances refresh every 30 s. No overlap, hidden tabs skipped, paused while a transaction dialog is open, form input untouched. Raw transactions are cached. A label shows "Auto-updating · Ns ago" |
| 7 | WizardConnect | **Done (phase 1, 2026-11-19)** | See below |
| 8 | Link to Staking Arena | **Done** | A companion-project card on About → Overview, and a footer link |
| 9 | Keep onboarding, oracle text, BPS concept | **Kept** | Not rewritten |

**WizardConnect, phase 1 (2026-11-19, owner-approved):** a second connect button on the Wallet page, next to
WalletConnect, for HD wallets (Cashonize 0.9+ HD wallets).
- **How:** `src/lib/wizardconnect/wizardconnect.ts` pairs over the WizardConnect Nostr relay (`wiz://` QR code or
  "Open in Cashonize web"), derives the trading address **receive/0** from the shared xpub, and signs with
  `inputPaths = [inputIndex, "receive", 0]` for every input that spends that address. The transaction builders are
  unchanged: every wallet input PennyPicker builds spends the one trading address, and cancels are authorised by a
  plain wallet input, so no contract input needs a wallet signature.
- **Safe for what worked:** the module is loaded on demand (its own ~100 KB chunk, never fetched unless used). The
  WalletConnect code path is unchanged apart from a type tag; `verifySignedMatchesUnsigned` checks WizardConnect
  signatures exactly like WalletConnect ones. The library session is stored per network.
- **Phase-1 limit:** only coins on receive/0 are used; the Wallet page says so. Phase 2 (multi-address coins) is post-hackathon.
- **Session handling:** restore from the stored session at once (address from stored xpubs); an explicit wallet
  disconnect ends the session in the app; a sign request the wallet never answers is cancelled after 3 minutes.
  Cashonize ends WizardConnect sessions when you switch wallets in it, so pair again after switching.
- **Tested on Chipnet** with a new Cashonize HD test wallet ("PP Wizard HD", funded with 0.0012 tBCH from PP Trader A,
  `a172bc15…8154f6`): pairing, address derivation (matches Cashonize's own receive/0), session restore after reload,
  an ask signed over WizardConnect and broadcast (`18c706e65205b2a5d44630acf9f731c38c6b2d1868245b68f668b514b8384f6f`),
  and its cancel (`8d8204f9a059aeae7dde033fae42d44dbe7eeb348d3c2f590297e0097761dd25`). Regression: the same wallet over
  WalletConnect still signs and verifies (signed, then discarded). Mainnet WizardConnect is code-ready but untested.
- **Unit tests:** `scripts/pennypicker-wizardconnect.test.ts` (14 checks, in CI): receive/0 derivation cross-checked
  with libauth, input paths only for trading-address inputs, relay JSON format.
- **Library:** `@wizardconnect/core` 0.2.10 and `@wizardconnect/dapp` 0.2.6 (pinned, Nov 12 releases) by Whiterun LLC
  (Riften Labs), LGPL-3.0-or-later per the source headers (npm shows no license field). Credited in the README,
  `SUBMISSION.md` and About → Safety & status.
- **Also fixed:** a WalletConnect session restore that Cashonize never answers no longer leaves the Wallet page stuck
  on "checking" with disabled buttons; after 20 s the buttons return with an explanation.

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
`74966ac56d7fed89db2ff4e21f912f18e83541fdd6ba6efcd55099f341a71de7`. A GIF recording of
this trade was in the README until 2026-11-20, when it was removed because it showed an older version of the site.

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
| `/wallet` | Connect Cashonize (QR, copy, Cashonize-web deep link), balances, **Send PUSD**, UTXO list |
| `/about` | About, with a section menu: Overview, How it works, Try it, Token, Oracle, Liquidations (simulations), Safety & status |
| `/about/token` | Selected stablecoin's details (PennyPickerUSD or ParyonUSD), your balance, market list |
| `/about/oracle` | Live oracles.cash price, on-chain reference, permissionless update, history |

The admin area was removed on 2026-11-19 (open source, no passwords). Its token and metadata tools did their one-time
jobs; the builders remain in `exchange.ts` and are covered by the tests.

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
- **What visitors see:** `/` is the Exchange (no redirect). The demo notice appears once per visit (and from the Demo badge), and a Chat button sits on every page.
- **CI:** `pennypicker-ci.yml` runs the tests and the build. The inherited Vox deploy workflows were removed.

## Tests

Run from `packages/app`, using libauth's BCH 2025 VM:

```
pnpm dlx tsx scripts/pennypicker-contracts.test.ts   # 33 covenant checks (incl. a real oracles.cash message and attack cases)
pnpm dlx tsx scripts/pennypicker-exchange.test.ts    # 100 builder checks (signed, chained txs, token genesis + transfer, identity safeguards, error texts, mainnet/ParyonUSD + cap, HD multi-address)
pnpm dlx tsx scripts/pennypicker-identity.test.ts    # 8 authchain/marking checks
pnpm dlx tsx scripts/pennypicker-wizardconnect.test.ts # 21 HD derivation, gap-limit scan and signing-path checks
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
- **No security review.** The covenants have not been independently reviewed.

## External actions required (you)

1. **Pushing:** GitHub credentials are cached in memory (git `credential.helper cache`, 7 days from 2026-11-18). After
   that expires, run `git fetch ibex-backup` once in your terminal so the agent can push again.
2. **Faucet top-ups:** tbch.googol.cash uses a CAPTCHA the agent may not solve.
3. **Mainnet go-live:** needs your approval (`DEPLOYMENT.md` §5).

## Release status (2026-11-18)

- **Done:**
  - Public site: Exchange, Token, Oracle, Wallet and About.
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
  - Vault contracts for liquidations and redemptions (the pricing simulations were removed on 2026-11-19).
