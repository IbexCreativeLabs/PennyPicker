# Demo video script (about 3 minutes)

**Setup before recording:**
- Two Cashonize wallets on Chipnet with test BCH and test PUSD.
- Browser A on https://pennypicker.pages.dev, paired with wallet A.
- Browser B (or a phone) paired with wallet B.

## 0:00 — The problem (20 s)
*Show the About page hero.*
"Stablecoin limit orders at a fixed dollar price go stale every time BCH moves. PennyPicker prices orders in basis
points relative to the live oracle price instead."

## 0:20 — The book (30 s)
*Exchange tab. Point at the BPS column, the price column and the reference line.*
"Each row is an order covenant. +25 means 0.25% above the oracles.cash BCH/USD price. When the oracle moves, every limit
moves with it, and nobody has to re-quote."
*Click the price badge → Oracle page.* "The price is signed by General Protocols, the same oracle ParyonUSD uses, and the
contract verifies the signature on-chain."

## 0:50 — Place a limit order (wallet B, 40 s)
*Limit order → Buy BCH → −25 BPS, 10 PUSD → Review.*
"The review lists every input and output. Cashonize signs only. The app checks the signed transaction matches the
preview, and nothing is broadcast until I press Broadcast."
*Sign in Cashonize → Broadcast.* The order appears in the book and under My orders.

## 1:30 — Take it (wallet A, 40 s)
*Click Sell on that bid → Trade now shows the price and amount → Review.*
"This fill also carries the newest signed oracle message, so it settles at the live price in the same transaction."
*Sign → Broadcast.* The bid shrinks, and the fill appears under Market fills with an explorer link.

## 2:10 — Why it matters (30 s)
*About page: the three pillars.*
"Swaps at 0 BPS replace 0% loans, P2P liquidation bids from 0 to −1000 BPS replace a flat 10% penalty, and redemptions
become market-priced."

## 2:40 — Mainnet and safety (20 s)
*Selector → ParyonUSD.*
"The same contracts run with the real ParyonUSD on BCH mainnet, live since November 18 with a 25 PUSD cap per order
until an external audit. Here is a real order, fill and cancel." *(Show the mainnet Market fills, or the mainnet table in
`SUBMISSION.md`.)*
*End on the README GIF or the transaction table.*
