# Handing over PennyPicker

Everything a new maintainer needs on one page. Details live in the linked files.

## What it is

An order book for BCH and USD stablecoins on Bitcoin Cash where every price is set in basis points (BPS) from the
live oracles.cash BCH/USD price, and every order is its own CashScript covenant.

- Live site: https://pennypicker.pages.dev
- Source: https://github.com/IbexCreativeLabs/PennyPicker (public, Unlicense)
- Markets: **PennyPickerUSD (PPUSD)** on Chipnet (test token, free) and **ParyonUSD (PUSD)** on mainnet (real
  money, 25 PUSD cap per order, no price keeper).

## Where things are

| What | Where |
|---|---|
| Covenants (CashScript 0.11.5) | `packages/app/src/lib/pennypicker/contracts/*.cash` (+ compiled `.json`) |
| Transaction builders | `packages/app/src/lib/pennypicker/exchange.ts` |
| Chain reads, order discovery, broadcast guard | `packages/app/src/lib/pennypicker/chain.ts` |
| Market IDs, mainnet switch and cap, community links | `packages/app/src/lib/pennypicker/deployment.ts` |
| Networks, explorers | `packages/app/src/lib/pennypicker/network.ts` |
| App state, polling, wallet sessions | `packages/app/src/lib/pennypicker/ui/session.svelte.ts` |
| WalletConnect (Cashonize) | `packages/app/src/lib/cashonize/walletconnect.ts` |
| WizardConnect (HD wallets) | `packages/app/src/lib/wizardconnect/wizardconnect.ts` |
| Review/sign/broadcast dialog | `packages/app/src/lib/pennypicker/ui/TxFlow.svelte` |
| Pages | `packages/app/src/routes/(pp)/` (Exchange `+page.svelte`, `wallet/`, `about/`) |
| Design tokens (light + dark) | `packages/app/src/lib/pennypicker/ui/theme.css` |
| Logo and icons | `packages/app/static/` (`pennypicker-*.png`, `favicon.*`, `ppusd-256.png`, `steamroller-880.webp`) |
| Token metadata (BCMR) | `packages/app/static/.well-known/bitcoin-cash-metadata-registry.json` |

## Run, test, build

```bash
pnpm install
cp packages/app/.env.example packages/app/.env   # add a WalletConnect (Reown) project ID
pnpm --filter app dev                            # http://localhost:5173

cd packages/app
pnpm dlx tsx scripts/pennypicker-contracts.test.ts      # 33 covenant checks (BCH 2025 VM)
pnpm dlx tsx scripts/pennypicker-exchange.test.ts       # 100 builder checks, signed and VM-verified
pnpm dlx tsx scripts/pennypicker-identity.test.ts       # 8
pnpm dlx tsx scripts/pennypicker-wizardconnect.test.ts  # 21
pnpm exec svelte-check --tsconfig ./tsconfig.json       # 0 errors expected
pnpm build                                              # writes the static site to /docs
```

CI (`.github/workflows/pennypicker-ci.yml`) runs the tests and the build on every push.

## Deploying

Cloudflare Pages project `pennypicker` builds `main` automatically (`pnpm app:build`, output `docs`). It needs only
`NODE_VERSION=22`, `PNPM_VERSION=10.6.3` and the public `VITE_WALLETCONNECT_PROJECT_ID`. There is no server code and
no secret. Full steps: [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Operating notes

- **Mainnet** is on (`MAINNET_WRITES_COMMITTED` in `deployment.ts`) with a 25 PUSD cap (`MAINNET_MAX_ORDER_UNITS`).
  There is no price keeper: a resting order can be filled at the last stored price in a quiet market. Raise the cap
  only after an independent audit. Going live steps: `DEPLOYMENT.md` §5.
- **Wallets** used for the deployment and tests live only in the owner's Cashonize (names such as "PP Operator",
  "PP Trader A/B", "PP Wizard HD", "PP Mainnet Maker"). No key or seed is in the repository; never add one.
- **Token metadata:** the PPUSD identity output is held by the "PP Operator" Chipnet wallet. To change the name,
  ticker or icon, edit the registry JSON, deploy, then publish a new revision from Cashonize (Wallet tools →
  Identities → publish metadata, pointing at the registry URL). Cashonize refuses app requests to spend identity
  coins, which is why this is done in the wallet.
- **WizardConnect:** libraries by Whiterun LLC (Riften Labs), LGPL-3.0-or-later, pinned (core 0.2.10, dapp 0.2.6)
  and credited on About → Safety. Relays: `relay.riften.net` (was down on 2026-11-19) and `relay.cauldron.quest`.
  Cashonize ends dapp sessions when you switch wallets in it; pair again afterwards. When Cashonize is already open in
  a tab, paste the pairing code there instead of using "Open in Cashonize web".
- **Polling:** the book is checked only while the Exchange or Oracle page is visible (`watchMarket()`), balances
  while the Exchange, Wallet or Token page is open (`watchWallet()`).

## Known limits and next steps

- One shared price record: simultaneous trades conflict and the second is rebuilt (shard it for scale).
- No keeper on mainnet; no independent audit (`SECURITY_REVIEW.md` is internal).
- Order discovery scans the last 300 transactions of the price record.
- WizardConnect on mainnet has not been tested with real funds.
- Liquidation and redemption contracts are designs only (see the README pitch); no code remains in the app.
- Full history, transaction IDs and design notes: [`PROJECT_STATUS.md`](PROJECT_STATUS.md), [`REPORT.md`](REPORT.md).
