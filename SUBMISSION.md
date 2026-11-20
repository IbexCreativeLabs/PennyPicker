# PennyPicker: hackathon submission

**Oracle Delta Basis Points Denominated Orderbook DEX for Stablecoins, on Bitcoin Cash.**

- Live demo: **https://pennypicker.pages.dev**. PennyPickerUSD (PPUSD) on BCH Chipnet (free test coins), and ParyonUSD
  (PUSD) on BCH mainnet (real money, 25 PUSD cap per order), chosen in the header
- Source: https://github.com/IbexCreativeLabs/PennyPicker

## The idea

Limit orders are priced in **basis points relative to the live oracle price** instead of a fixed dollar price, so they
never go stale when BCH moves. Every core mechanism of a stablecoin protocol is a spread trade against the oracle, so
one P2P market of this kind could replace three protocol mechanics:

1. **Swaps instead of "0% interest loans".** Users swap BCH for the stablecoin against resting bids near 0 BPS.
2. **P2P liquidations instead of a flat 10% penalty.** Bids from 0 to −1000 BPS replace the Stability Pool, and
   competition drives the discount down.
3. **Market-based redemptions.** Redemption-eligible loans sit on the book; there is no baseRate decay math.

## What is built and working

| Piece | Status |
|---|---|
| **Order covenant** (`PennyPickerOrder.cash`) | Each order is its own P2SH32 contract holding the escrow. `fill()` settles exactly against `reference × (10000+bps)/10000` with integer math. `cancel()` is maker-only. Partial fills work in both directions. |
| **Real oracle** (`PennyPickerOracle.cash`) | Uses the BCH/USD price signed by General Protocols (oracles.cash), the same oracle ParyonUSD uses. The signature is verified on-chain with `OP_CHECKDATASIG`, updates are permissionless, and replay is blocked by a strictly increasing sequence. Orders and fills carry the newest message, so they trade at the live price. |
| **Exchange UI** | Orderbook in BPS that updates itself while it is on screen, limit orders, "trade now" routing across orders, my orders with cancel, activity, plus Wallet and a sectioned About (with Token and Oracle). Fully public: no admin area and no passwords. |
| **Wallet** | Cashonize over WalletConnect, or any HD wallet over WizardConnect (all used addresses are scanned and spent from, each input signed with its own HD path). Keys never leave the wallet. Every transaction is previewed, signed in the wallet, checked byte-for-byte against the preview, and broadcast only on an explicit click. |
| **Contention handling** | If someone else uses the shared price record first, the app says nothing was broadcast and offers **Rebuild with the latest state**. |
| **Mainnet** | Selecting ParyonUSD switches the whole app to BCH mainnet: addresses, Cashonize chain and Electrum. A mainnet price record exists, and a real order, fill and cancel with ParyonUSD were done (txids below). Mainnet trading is open on the public site, capped at 25 PUSD per order. |

## Verify it yourself on Chipnet

All of these were signed in Cashonize and broadcast from the app:

| What | Transaction |
|---|---|
| Oracle created from a signed oracles.cash message | `34533fc4635527016456e3965b1cc31e5a7037c0a4537282480feaf57a6d0e27` |
| Trader B buys from an ask; the fill carries a newer signed price | `bc35fd555f665b194df906b1493b618c2c45080498f5db5a80a0d603fad91036` |
| Two-wallet trade on the public site (the GIF) | `74966ac56d7fed89db2ff4e21f912f18e83541fdd6ba6efcd55099f341a71de7` |
| A sells into B's bid (v3 test) | `e3098a63bb4163ef1d8aaa11d419f073b14e0ccda3bac4307ad46b730a7b83ae` |
| Conflict rejected, then rebuilt and accepted | `1f0ff030c55407152db8e18d228c93c0c69cdcd7625186d3ae95d7393b52a57f` |

**On BCH mainnet with real ParyonUSD** (owner-approved, small amounts; explorer `https://bchexplorer.cash/tx/<txid>`):

| What | Transaction |
|---|---|
| Mainnet price record created from oracles.cash | `95734104aa53ada1642974ea3ea778c00da10bf9c42ef346bc395006693c5473` |
| Maker ask: 0.0005 BCH at +50 BPS | `650e7000ddcc1a5a43d203b6ff625ad2f09a5228a2a0ac03c377403721117a24` |
| Taker buys 0.0002 BCH for 0.05 ParyonUSD | `3bbf492694ed79255b6397b80c9aef3829d0245bbff250e1bb5134f278fb7cc0` |
| Maker cancels the remainder | `c46482bf44c750556e51351cc6f62513d790f594d6addad7f6e04a9d4f4b4c1e` |

Explorer for the Chipnet rows: `https://bchexplorer.cash/chipnet/tx/<txid>`. The full log is in [`PROJECT_STATUS.md`](PROJECT_STATUS.md).

**Try it:** follow the steps under *Try it in 5 minutes* in the [README](README.md) or on the About page. The
Chipnet book is seeded with asks and bids around the oracle price.

## Tests

Run from `packages/app`. The covenants are executed in libauth's BCH 2025 virtual machine:

- **33 covenant checks:** valid and invalid fills, forged or replayed oracle messages, a real oracles.cash message, and
  attack cases.
- **100 transaction-builder checks:** chained signed transactions, mainnet ParyonUSD order and fill, the order cap, and
  the broadcast switch.
- **8 token-identity checks** and **21 WizardConnect checks** (HD address scan, per-input signing paths).

CI runs these and the production build on every push.

## Security

See [`SECURITY_REVIEW.md`](SECURITY_REVIEW.md). An internal review found no way to take funds from an order or to fake
the price. The main mainnet risk is economic: stale-price pick-off in quiet markets, mitigated by a keeper that pushes
each oracle message. An independent audit is required before mainnet trading with meaningful amounts.

## Limitations and next steps

- **Single price record.** Concurrent traders conflict and rebuild. For scale, shard the state across several records.
- **Mainnet.** Live with a 25 PUSD cap per order. There is no price keeper yet, so a resting order can be filled at the
  last stored price in a quiet market; keep mainnet orders small and short-lived. An external audit is needed before the
  cap is raised.

## Credits

Forked from [Vox](https://github.com/2qx/vox) by 2qx. Built with CashScript, Libauth, Cashonize and the General
Protocols oracles. WizardConnect support uses `@wizardconnect/core` and `@wizardconnect/dapp` by Whiterun LLC (Riften
Labs), LGPL-3.0-or-later ([source](https://gitlab.com/riftenlabs/lib/wizardconnect)).
