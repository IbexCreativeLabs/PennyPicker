# PennyPicker: status report and plan to finish

**As of 2026-11-18. Deadline 2026-11-22.**

## 1. What the site can do today

Live at **https://pennypicker.pages.dev** (BCH Chipnet, free test coins).

- **Trade BCH against a stablecoin using orders priced in BPS from the live oracle.**
  - Place buy or sell limit orders at ±BPS from the oracles.cash BCH/USD price. Each limit moves with the price
    automatically.
  - "Trade now" fills across the best orders in one transaction.
  - Cancel your own orders at any time.
- **Real oracle on-chain.** The General Protocols (oracles.cash) signature is verified by the contract. Anyone can push
  a newer price, and trades carry the newest signed price so they settle at the live rate.
- **Wallet:** Cashonize over WalletConnect.
  - Every transaction is previewed and signed in the wallet.
  - The app checks the signed transaction matches the preview, and broadcasts only on an explicit click.
  - A rejected broadcast is reported honestly, with a one-click **Rebuild** when someone else traded first.
- **Token: PennyPickerUSD (PUSD).** A 1,000,000 fixed-supply test stablecoin. Its metadata is published on-chain, so
  Cashonize shows the name, ticker and icon.
- **Markets:**
  - PennyPickerUSD on Chipnet: tradable.
  - ParyonUSD on mainnet: view-only, with the same contracts, mainnet addresses and Cashonize chain. Mainnet sending
    is switched off, and orders are capped at 25 PUSD.
- **Pages:**
  - Exchange, with a getting-started guide, depth bars and live price movement.
  - Token, Oracle and Wallet.
  - About, with the pitch, a "try it in 5 minutes" guide, and liquidation and redemption pricing simulations.
  - A Telegram chat button.
  - A password-protected admin area: setup progress, token tools, metadata publishing, simulator and mainnet
    readiness.
- **Quality:**
  - Tests run the contracts in the BCH 2025 virtual machine: 33 contract checks and 92 transaction-builder checks,
    plus 17 other checks.
  - CI runs the tests and the build on every push.
  - An internal security review is in `SECURITY_REVIEW.md`.
  - The live site has no console errors, and the mobile layout was checked.

## 2. What was done (highlights)

| Area | Done |
|---|---|
| Contracts | Order covenant (exact settlement, maker-only cancel) and oracle covenant (signature-verified, replay-proof, permissionless updates) |
| On-chain proof | Real two-wallet trades in both directions, cancels, oracle updates and conflict recovery, all on Chipnet with txids in `PROJECT_STATUS.md`. A GIF of a trade on the public site is in the README |
| Site | Public and admin split, stablecoin selector, Telegram chat, About with the pitch, Vox removed and only credited |
| Repo | Ready to publish: personal email removed from history, unused Vox code removed (532 → ~215 files), 0 type errors |
| Mainnet groundwork | Network-aware app, ParyonUSD market, write switch, order cap, mainnet tests and a readiness checklist |
| Fixes found by live testing | Stale saved IDs emptied the book; a library broadcast call reported rejected transactions as accepted |
| Polish | Seeded orderbook, token metadata (BCMR), visual refresh, getting-started guide |
| Docs | README, `SUBMISSION.md`, `DEMO_SCRIPT.md`, `SECURITY_REVIEW.md`, `DEPLOYMENT.md`, `PROJECT_STATUS.md` |

## 3. Still to do, most important first

1. **Record the demo video and submit.** Judges need it. The script is in `DEMO_SCRIPT.md`. *Owner: you.*
2. **Decide on mainnet for the final prototype.** You said the final prototype must run on mainnet. Everything is
   built and tested in the VM; what's left needs your approval and a few dollars of real BCH:
   - a dedicated mainnet operator wallet;
   - one transaction (about 2,000 sats) to create the mainnet price record;
   - turning on `MAINNET_WRITES_ENABLED`;
   - small real test trades with ParyonUSD.
3. **Price keeper for mainnet.** Without one, resting orders can be filled at a stale price in quiet markets. A small
   scheduled job pushing each oracles.cash message costs about 300 sats a minute; it can run every few minutes to
   save cost. It needs a hot wallet whose key is stored as a Cloudflare secret, which needs your approval.
4. **External security audit.** Required before raising the 25 PUSD cap. Not realistic before Nov 22, so it is
   post-hackathon.
5. **Liquidation and redemption contracts.** They are simulations today; they are the long-term vision, so this is
   post-hackathon.
6. **Nice to have:** price chart from oracle history; splitting the single price record so many traders don't
   collide; automatic rebuild-and-resign.

## 4. Suggested plan to the finish

| Day | Work | Who |
|---|---|---|
| **Nov 18 (today)** | Done: metadata, UI polish, report | Claude |
| **Nov 19** | Record the demo video from `DEMO_SCRIPT.md` (two wallets, about 3 min). Decide go or no-go on mainnet. Final end-to-end pass on the live site from a fresh browser | You (video, decision); Claude (pass and fixes) |
| **Nov 20** | **If go:** you fund a fresh mainnet operator wallet (about 0.0005 BCH) and two trader wallets (a few dollars of BCH and ParyonUSD). With your approval per transaction I create the mainnet price record, enable writes (25 PUSD cap), and run one ask, one fill and one cancel, recording the txids. Decide on the keeper (scheduled job plus secret, or none for the demo). **If no-go:** extra polish and a price chart | Both |
| **Nov 21** | Freeze features. Update `SUBMISSION.md` and the README with the final txids (and mainnet ones if made). Make the repo public. Submit | Claude (docs); you (repo visibility, submission) |
| **Nov 22** | Buffer for fixes only | — |

**Decisions needed from you:**
1. Mainnet go or no-go for the final prototype.
2. If go, whether to run a keeper (it needs a hot wallet secret in Cloudflare).
