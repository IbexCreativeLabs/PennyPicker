# PennyPicker: status report and plan to finish

**As of 2026-11-19 (night). Deadline 2026-11-22.** Live build `4c9c404`. Handover notes: [`HANDOFF.md`](HANDOFF.md).

## 1. What the site can do today

Live at **https://pennypicker.pages.dev** (source public at https://github.com/IbexCreativeLabs/PennyPicker), with
two markets chosen in the header:

- **PennyPickerUSD (PPUSD) on BCH Chipnet:** free test coins, safe for judges to try.
- **ParyonUSD (PUSD) on BCH mainnet:** real money since 2026-11-18, capped at 25 PUSD per order, with no price keeper.

What it does:

- **Explains itself at first sight.** The Exchange opens with the steamroller and "Don't pick up pennies in front of the
  steamroller", one sentence on BPS, and a live diagram that places the real bids, asks and the order you are typing
  around the oracle price.
- **Trade BCH against a stablecoin in a floating order book.**
  - Buy or sell limit orders at ±BPS from the oracles.cash BCH/USD price; each limit moves with the price.
  - "Trade now" fills across the best orders in one transaction; cancel your own orders at any time.
  - The book and best bid/ask update on their own every few seconds while the Exchange is on screen (read-only), with
    loading placeholders instead of misleading empty states; the market loads in about 3 s without waiting for the wallet.
- **Real oracle on-chain, explained by comparison.** A pull oracle like Pyth: General Protocols signs the price (the
  same feed AnyHedge and ParyonUSD use), traders bring the newest signed price into their transaction, and the contract
  verifies it. The Oracle page has a Chainlink / Pyth / PennyPicker table and a 30-second example with today's price
  whose "Try it" button pre-fills an order.
- **Two wallet connections.**
  - Cashonize over WalletConnect (any Cashonize wallet).
  - **WizardConnect** for HD wallets: every used address is found, counted and spent from.
  - Every transaction opens in a review popup, is signed in the wallet, checked against the preview and broadcast only
    on an explicit click. A rejected broadcast offers **Rebuild** when someone else traded first.
  - The header shows the connected wallet's real BCH and PUSD balances.
- **Token: PennyPickerUSD (PPUSD).** 1,000,000 fixed-supply test stablecoin with on-chain metadata and the steamroller
  icon.
- **Pages:** Exchange, Wallet, and About with a section menu (How it works, Token, Oracle, Safety & status), a link to
  the companion project **Staking Arena**, a Telegram chat button, and the demo notice on each visit.
- **Safety on mainnet:** real-money warnings, a 25 PUSD cap enforced by the builder and the form, and a build-level
  write switch.

## 2. What was done today (2026-11-19)

| Area | Done | Commits |
|---|---|---|
| Open source and privacy | Admin area and its password check removed (site fully public, no secrets). Full history audited before going public: no personal email, keys, tokens or secrets (the only keys are upstream Vox test fixtures). Repo made public by you | `0d90376`, `531fddf` |
| About | Rebuilt as a sectioned menu with cards instead of text walls; Token and Oracle moved into it; old links redirect | `0d90376` |
| Explorer | Transaction and address links use bchexplorer.cash (mainnet and `/chipnet`) | `011f653`, `7be073b` |
| Community feedback | Headline and live BPS diagram; loading placeholders; "Floating order book" explanation; review as a centered popup; header balances; read-only auto-refresh; Staking Arena link | `6185b0b`, `9a548cf`, `e74951f` |
| Root-cause fix | The "first 15 s look broken" report: market data waited for the wallet to answer. Now loads at once (book in ~2–3 s on a cold visit) | `6185b0b` |
| Oracle for judges | Pyth/Chainlink comparison, AnyHedge/ParyonUSD feed, live 30-second example with a "Try it" pre-fill | `5c2ab05`, `6e31973` |
| WizardConnect | Phase 1 shipped and live; LGPL libraries pinned and credited; a stuck "checking" wallet state fixed (buttons return after 20 s); unanswered sign requests time out | `8460b38` |
| Demo | `DEMO_SCRIPT.md` rewritten for the new features (about 3½ min); Exchange example toggle removed | `d8d9e45` |
| Final changes | Steamroller logo and colours (light and dark), memorable hero, design pass; PUSD → PPUSD; no Refresh button, polling only while data is on screen; About cut to one "How it works" page; simulations removed; WizardConnect over the whole HD wallet; two bug fixes; `HANDOFF.md` | `4c9c404` and the docs commit after it |

**Chipnet transactions today (all accepted):**
- WizardConnect test wallet funded from PP Trader A: `a172bc15…8154f6`.
- Ask signed over WizardConnect: `18c706e65205b2a5d44630acf9f731c38c6b2d1868245b68f668b514b8384f6f`.
- Its cancel, signed over WizardConnect: `8d8204f9a059aeae7dde033fae42d44dbe7eeb348d3c2f590297e0097761dd25`.

**Tested:** all suites pass (contracts 33, transaction builders 100, identity 8, WizardConnect 21), 0 type
errors, production build OK, CI on every push. In the browser: the review popup, auto-refresh pausing during review,
pre-fill links, phone width (no sideways scroll), cold-load timing on the live site, WizardConnect pairing on the live
site, and WalletConnect re-checked after the WizardConnect change. Every commit carries the `Committed-by` line and
passed a personal-data and secrets screen.

**Also on Chipnet tonight (WizardConnect over several addresses):** an ask funded from receive/1
`dde2420509276b95a8d7ec5a76406bb8eb9fc3f95fbf83461a98e3cd3a9bc449` and its cancel
`586b63d552f7edc77a2ea0362df85f71132808eed4f5ef28d20a0726ebc9db9e`. Token metadata republished with ticker PPUSD and the steamroller
icon: `60313792d3c4ba225bc76b9eb8387d9875bf72b7a9c93e9b5c20b207c5077aea`.

## 3. Still to do, most important first

1. **Record the demo video** with `DEMO_SCRIPT.md`. Wallet B must be a Cashonize **HD** wallet for the WizardConnect
   scene, and pair after choosing the wallet (Cashonize ends sessions when you switch). *Owner: you.*
2. **Submit** with the links in `SUBMISSION.md`. *Owner: you.*
3. **Back up both mainnet wallets' seed phrases** in Cashonize; they still show "not backed up". *Owner: you.*
4. **Check which wallet Cashonize has open** before any mainnet use: it was left on "PP Operator" (Chipnet) after the
   metadata update. *Owner: you.*
5. **Optional:** ask GitHub Support to purge the old pre-rewrite commits; send faucet tBCH to PP Trader B
   (`bchtest:qrxy22p45mzt6tg0e3hjqmy8sz6jgqzjmvw89lgp4t`) so I can place deeper Chipnet asks (each holds 0.001 BCH
   today).
6. **Post-hackathon:**
   - a mainnet WizardConnect test (needs your approval);
   - a price keeper for mainnet (needs a hot-wallet secret in Cloudflare);
   - an independent audit before raising the 25 PUSD cap;
   - liquidation and redemption contracts;
   - sharding the single price record, and a price chart.

## 4. Plan to the finish

| Day | Work | Who |
|---|---|---|
| **Nov 19** | Done: open-sourcing, About rebuild, community feedback, oracle comparison, WizardConnect, demo script, this report | Claude |
| **Nov 20** | Record the video. Back up the mainnet seeds. I re-check the live site and fix anything found | You; Claude |
| **Nov 21** | Submit. Optional: tBCH for deeper asks | You |
| **Nov 22** | Buffer only: no new features | — |
