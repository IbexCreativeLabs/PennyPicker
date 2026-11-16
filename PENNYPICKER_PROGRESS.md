# PennyPicker development progress

## Current milestone

- Added an isolated `/penny-picker` market prototype with a browser-local demo book.
- Added integer-only BCH/PUSD rate, BPS pricing, quote rounding, order validation,
  price-time matching and partial-fill calculations.
- Added an explicitly development-only mock oracle fixture. It is not a market quote,
  does not imply a PUSD peg and cannot be used for chain execution.
- Added links to the market from the app home page and header.
- Existing `/cashonize` connection remains available. This milestone does not request
  signing permission, construct transactions, sign or broadcast.

## Important architecture findings

- CatDex is a real UTXO exchange and remains useful reference infrastructure. Its
  current order commitment contains quantity and an absolute floating-point price.
  That representation cannot enforce a BCH/PUSD price anchored to a fresh oracle and
  expressed as an order BPS delta. Reuse of its settlement contract would need a
  protocol and covenant change, not just a UI conversion.
- PUSD has no deployed CashToken category. The configured supply (1,000,000 PUSD,
  two decimals, fixed) still requires a real genesis transaction and Cashonize approval.
- Photon is a BCH proof-of-work oracle, not a BCH/PUSD price oracle.
- No authenticated and manipulation-resistant BCH/PUSD oracle feed is configured.
  Stale or untrusted prices must block order matching and transaction execution.

## Next implementation order

1. Choose and review a BCH/PUSD oracle source with freshness, authenticity, outage and
   manipulation controls. Until then, keep only the development simulation.
2. Design a PennyPicker order covenant/commitment that binds asset category, side,
   quantity, BPS delta, oracle reference policy and partial-fill state. Review script
   invariants and funding/rounding before preparing a transaction builder.
3. Obtain PUSD category through the explicitly approved Chipnet genesis flow.
4. Implement chain indexing/discovery and unsigned order creation/cancellation using
   the reviewed covenant; distinguish created, indexed, matched, signed, broadcast
   and confirmed states.
5. Connect unsigned BCH transactions to Cashonize approval and verify broadcast UTXOs.
6. Only then investigate peer-to-peer liquidation and market-priced redemption.

## Scope of this prototype

The current book and mock oracle are in-memory demonstration data. They are not shared,
not persistent, not on-chain and not safe to use for trades. PUSD is experimental and
has no promised USD value or backing.
