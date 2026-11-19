# PennyPicker: status report and plan to finish

**As of 2026-11-18 (evening). Deadline 2026-11-22.**

## 1. What the site can do today

Live at **https://pennypicker.pages.dev**, with two markets chosen in the header:

- **PennyPickerUSD on BCH Chipnet:** free test coins, safe for judges to try.
- **ParyonUSD on BCH mainnet:** real money since 2026-11-18, capped at 25 PUSD per order, with no price keeper.

What it does:

- **Trade BCH against a stablecoin with orders priced in BPS from the live oracle.**
  - Place buy or sell limit orders at ±BPS from the oracles.cash BCH/USD price. Each limit moves with the price
    automatically.
  - "Trade now" fills across the best orders in one transaction.
  - Cancel your own orders at any time.
- **Real oracle on-chain.**
  - The contract verifies the General Protocols (oracles.cash) signature.
  - Anyone can push a newer price.
  - Trades carry the newest signed price, so they settle at the live rate.
- **Wallet: Cashonize over WalletConnect, on Chipnet and mainnet.**
  - Every transaction is previewed and signed in the wallet, checked against the preview, and broadcast only on an
    explicit click.
  - A rejected broadcast is reported honestly, with a one-click **Rebuild** when someone else traded first.
- **Token: PennyPickerUSD (PUSD).** A fixed-supply test stablecoin of 1,000,000. Its metadata is published on-chain, so
  Cashonize shows the name, ticker and icon.
- **Pages:**
  - Exchange, with a network-aware getting-started guide, depth bars and live price movement.
  - Wallet.
  - About, with a section menu: Overview, How it works, Try it, Token, Oracle, Liquidations (simulations), Safety & status.
  - A Telegram chat button, and the demo notice on each visit.
- **Safety on mainnet:** a red real-money warning on every mainnet screen, a 25 PUSD cap enforced by the transaction
  builder and the form, and a build-level write switch.

## 2. What was done

| Area | Done |
|---|---|
| Contracts | Order covenant (exact settlement, maker-only cancel) and oracle covenant (signature-verified, replay-proof, permissionless updates) |
| On-chain proof, Chipnet | Two-wallet trades in both directions, cancels, oracle updates, conflict recovery and the token metadata publication. Txids are in `SUBMISSION.md` and `PROJECT_STATUS.md` |
| On-chain proof, mainnet | Price record created, then an ask, a fill with real ParyonUSD and a cancel (txids in `SUBMISSION.md`). Mainnet trading is open on the public site |
| Site | Fully public site (no admin area, no passwords), sectioned About, market selector, getting-started guide, visual refresh, BCMR token metadata, Telegram chat |
| Fixes from live testing | Stale saved IDs emptied the book; a library reported rejected broadcasts as accepted; a deploy-time cache bug broke the page for a few seconds after each deploy |
| Final polish (today) | The guide and market header now adapt to mainnet; a loading state replaces the "No oracle" flash; balances show "…" until loaded; the wording is accurate ("internal review, no independent audit"); docs updated to mainnet-live |
| Tests | Contracts, transaction builders, mechanisms and identity tests, run in the BCH 2025 VM: 142 checks pass. 0 type errors. CI on every push |
| Docs | README (with GIF), `SUBMISSION.md`, `DEMO_SCRIPT.md`, `SECURITY_REVIEW.md`, `DEPLOYMENT.md`, `PROJECT_STATUS.md` |

## 3. Still to do, most important first

1. **Record the demo video** with `DEMO_SCRIPT.md` (about 3 minutes; the last part now shows the live mainnet market).
   *Owner: you.*
2. **Make the GitHub repo public** (the history is already cleaned) **and submit** with the links in `SUBMISSION.md`.
   *Owner: you.*
3. **Back up both mainnet wallets' seed phrases** in Cashonize, since they hold real funds. *Owner: you.*
4. **Optional: deepen the Chipnet asks.** The asks hold 0.001 BCH each, because the test wallets have only about
   0.002 tBCH left. If you send a little more tBCH from the faucet to PP Trader B
   (`bchtest:qrxy22p45mzt6tg0e3hjqmy8sz6jgqzjmvw89lgp4t`), I can place larger asks. Judges can already sell into the
   30 PUSD bids and buy back small amounts.
5. **Post-hackathon:**
   - a price keeper for mainnet (needs a hot-wallet secret in Cloudflare);
   - an external audit before raising the 25 PUSD cap;
   - liquidation and redemption contracts;
   - sharding the single price record;
   - a price chart.

## 4. Plan to the finish

| Day | Work | Who |
|---|---|---|
| **Nov 18** | Done: mainnet live, final polish, docs, this report | Claude |
| **Nov 19** | Record the video. Optionally send tBCH to Trader B for deeper asks | You |
| **Nov 20** | Make the repo public and submit. I re-check the live site and fix anything found | You; Claude |
| **Nov 21–22** | Buffer only: no new features | — |
