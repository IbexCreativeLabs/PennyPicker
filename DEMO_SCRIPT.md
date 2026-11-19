# Demo video script (about 3½ minutes)

**Setup before recording:**
- Two Cashonize wallets on **Chipnet** with test BCH and test PUSD: wallet A (any type) and wallet B. For the
  WizardConnect moment, make wallet B an **HD wallet** (Cashonize → Add wallet → HD).
- Browser A on https://pennypicker.pages.dev paired with wallet A (Wallet → *Connect Cashonize*).
- Browser B (or a phone) ready to pair wallet B.
- Close the demo notice once in each browser (it shows once per visit). Hide the getting-started guide if you
  want a cleaner screen.
- Tip: Cashonize ends its dapp sessions when you switch wallets inside it, so pair after choosing the wallet.

## 0:00 — The idea in five seconds (25 s)
*Exchange, top of the page: headline and the diagram.*
"Stablecoin limit orders at a fixed dollar price go stale every time BCH moves. PennyPicker prices orders in basis
points from the live oracle price instead. In this diagram the live price is in the middle, bids sit on the green side,
asks on the red side, each placed by its BPS."
*Type +25 into the order form: the 'Your order' marker moves on the diagram and shows its price.*

## 0:25 — The floating order book (30 s)
*Point at the book, the reference row and the "Auto-updating · just now" label.*
"This is a floating order book. Each row is its own Bitcoin Cash contract. +25 means 0.25% above the oracles.cash
BCH/USD price, so when the oracle moves, every price here moves with it and nobody has to re-quote. The book and the
best bid and ask refresh on their own every few seconds."
*Point at the header pill:* "My wallet's real BCH and PUSD balances are always top right."

## 0:55 — The oracle, compared with one you know (30 s)
*About → Oracle. Show the "If you know Pyth" card and the table, then the example below it.*
"It's a pull oracle, like Pyth: the price is signed off-chain by General Protocols, the same feed AnyHedge and
ParyonUSD use, and whoever trades brings the newest signed price into their own transaction. The contract checks the
signature and only accepts newer prices. Here is the whole idea in one example with today's price: Alice bids at
−50 BPS, BCH rises 1%, and her bid follows by itself."
*Click "Try it: pre-fill a −50 BPS bid": the Exchange opens with the bid filled in.*

## 1:25 — Place a limit order over WizardConnect (wallet B, 40 s)
*Browser B: Wallet → **Connect with WizardConnect** → scan or "Open in Cashonize web" → Connect.*
"Besides WalletConnect, PennyPicker supports WizardConnect, the newer protocol for HD wallets."
*Exchange → Limit order → Buy BCH → −25 BPS, 10 PUSD → Review.*
"The review opens front and centre. It lists every input and output. The wallet only signs; the app checks the signed
transaction matches the preview, and nothing is broadcast until I press Broadcast."
*Sign in Cashonize → Broadcast.* The order appears in the book within seconds, without a refresh, and under My orders.

## 2:05 — Take it (wallet A, 35 s)
*Browser A: click Sell on that bid → Trade now shows the price and amount → Review → Sign → Broadcast.*
"This fill also carries the newest signed oracle message, so it settles at the live price in the same transaction."
The bid shrinks, and the fill appears under Market fills with an explorer link.

## 2:40 — Why it matters (25 s)
*About → Overview: the before/after cards.*
"Swaps at 0 BPS replace 0% loans, peer-to-peer liquidation bids from 0 to −1000 BPS replace a flat 10% penalty, and
redemptions become market-priced. And PennyPicker is one half of a larger stablecoin design; the other half is
Staking Arena." *Point at the companion-project card.*

## 3:05 — Mainnet and safety (25 s)
*Header selector → ParyonUSD (Mainnet).*
"The same contracts run with the real ParyonUSD on BCH mainnet, live since November 18 with a 25 PUSD cap per order
until an independent audit." *Show Market fills (the real order, fill and cancel) or the mainnet table in
`SUBMISSION.md`.* "Everything is open source, and the risks are listed under About → Safety & status."
*End on the Exchange headline and diagram.*
