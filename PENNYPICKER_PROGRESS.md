# PennyPicker development progress

## Current milestone

- Added an isolated `/penny-picker` market prototype with a browser-local demo book.
- Added integer-only BCH/PUSD rate, BPS pricing, quote rounding, order validation,
  price-time matching and partial-fill calculations.
- Added an explicitly development-only mock oracle fixture. It is not a market quote,
  does not imply a PUSD peg and cannot be used for chain execution.
- Added links to the market from the app home page and header.
- Added Cashonize-connected, watch-only Chipnet balance loading to the market screen.
  It separates BCH-only funding from total BCH backing UTXOs and shows PUSD only when
  a locally stored category has been verified after confirmed genesis.
- Added a PUSD Chipnet genesis preparation flow using `TestNetWatchWallet` only. It
  constructs the exact 1,000,000 PUSD supply with no minting NFT, previews the
  vout 0 input and candidate category, requests signing only after a button click,
  explicitly sets WalletConnect `broadcast: false`, verifies the signed transaction
  against the preview, and makes broadcast and post-broadcast UTXO checking separate
  user actions.
- Existing `/cashonize` connection remains available. This milestone does not request
  keys or initialize a signing wallet. No transaction was built, signed or broadcast
  during development.
- Added an optional BCH-only self-transfer preparation step when the connected address
  lacks a confirmed BCH-only vout 0. It uses `TestNetWatchWallet.sendMax` pinned to one
  confirmed nonzero-vout UTXO and validates the single output returns to the same
  Chipnet address at vout 0. It also validates source-output scripts, value and
  outpoints against confirmed BCH-only UTXOs at that address. Cashonize signing,
  broadcast, and confirmation checking are separate user actions. Genesis now uses
  only confirmed BCH-only funding UTXOs.
- Added an exportable BCMR-v2 draft after the PUSD genesis output is confirmed. It is
  bound to the verified category, marks PUSD as experimental and not USD-backed, and
  reports the SHA-256 of the exact downloaded JSON bytes. It does not alter Vox's
  existing metadata registries, upload the file, or claim on-chain authentication.

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
- Riften Labs documents price endpoints keyed by exact token category, but its public
  examples use the Cauldron indexer host and document no Chipnet endpoint, signed
  response, or authenticated-feed guarantee. Historical responses include a timestamp;
  current responses contain only a price. These endpoints cannot authorize execution.
  A Chipnet reference source remains unresolved, and a market price must not be
  substituted for PUSD/USD or treated as a guaranteed peg. References:
  [Riften Labs Indexer API](https://docs.riftenlabs.com/cauldron/API/) and
  [Cauldron endpoints](https://docs.riftenlabs.com/cauldron/API/cauldron/).
- Source review of `packages/cauldron` found contract derivation for a supplied pool
  public-key hash, but no pool discovery or reserve index. CatDex's `getAllMarketOrders`
  similarly queries only caller-supplied script hashes. A direct PennyPicker-category
  spot/TWAP reference therefore needs an explicit indexer plus proof/authentication
  strategy; arbitrary Electrum UTXO responses are not a production oracle.
- Current BCH transaction-introspection opcodes expose transaction fields such as
  `nLockTime`, but not current block height or block time. `OP_CHECKLOCKTIMEVERIFY`
  provides a not-before constraint; it cannot make a signed quote unspendable after
  an expiry. Therefore a covenant can authenticate the quote but cannot independently
  enforce a maximum quote age with current BCH script rules. An app-side freshness
  check would remain a trust assumption because third parties can construct their own
  fills. References: [BCH native introspection CHIP](https://github.com/bitjson/bch-2022/blob/master/CHIP-2021-02-Add-Native-Introspection-Opcodes.md),
  [BCH locktime rules](https://documentation.cash/protocol/blockchain/transaction.html).
- ParyonUSD also uses the `PUSD` symbol on BCH mainnet. PennyPicker's planned Chipnet
  category is a separate experimental token, so the ticker is not a unique identifier;
  UIs and market data must identify assets by category. ParyonUSD prices are not a
  valid proxy for this token's price. Reference: [ParyonUSD token identity](https://paryonusd.com/).
- Tightened the production oracle execution boundary to require a 32-byte expected
  PUSD category and the same category on both provider configuration and observation.
  Fill previews retain that exact category alongside the quote. The demo quote remains
  unbound; category identity alone does not authenticate a price or make it fresh on-chain.
- Oracles.cash exposes signed BCH/USD data and provides a way to validate freshness,
  but that feed cannot establish a BCH/PUSD price while PUSD is an experimental token
  without a USD peg. Do not convert BCH/USD into BCH/PUSD by assuming PUSD equals USD.
  A future provider needs a direct market reference or an independently justified
  PUSD/USD observation plus a reviewed composition and trust policy. Reference:
  [Oracles.cash](https://oracles.cash/) and its
  [source repository](https://github.com/Bitcoin-com/oracles.cash).
- Order BPS convention is now enforced in the market core: buy-PUSD deltas are zero
  or negative (at/below reference); sell-PUSD deltas are zero or positive (at/above
  reference). Matching rejects duplicate IDs, invalid remaining quantities, malformed
  timestamps, and side/delta combinations. The current per-fill BCH quote rounds up
  to satoshis; cumulative rounding still needs covenant-level review before trading.
- Market order drafts and matching now enforce the CashTokens signed-int64 token
  amount bound, and BCH quote conversion rejects outputs above the maximum monetary
  supply. The shared bound is used by both the market layer and commitment codec.
- Genesis preparation now checks every unsigned input against its same-index
  Cashonize source output, requires all input unlocking scripts to be empty, and
  validates the PUSD output value and destination script before presenting the
  unsigned transaction for wallet approval.
- Added a typed execution-oracle boundary: a future transaction builder must use a
  fresh observation from a production provider whose adapter authenticates the data.
  The development mock cannot satisfy this type and is still used only for local
  arithmetic. No provider currently implements this interface.
- Added a draft 14-byte BPS order commitment codec: version, explicit side, remaining
  PUSD base units, and signed BPS delta. It is isolated from CatDex because the
  current covenant does not enforce this format. The reference quote is intentionally
  supplied at fill time; the eventual covenant must authenticate it and ensure the
  escrow can cover a changing BCH/PUSD rate. Fourteen bytes is within CashTokens'
  40-byte NFT commitment limit ([specification](https://cashtokens.org/docs/spec/chip/)).
- Added a single-fill preview for this draft format. It requires the typed verified
  oracle, enforces signed side/quantity rules, calculates the BPS limit and BCH amount
  in integer arithmetic, checks buy-side BCH and sell-side PUSD escrow, and returns
  the updated remaining commitment. It uses ceil-to-satoshi per fill; repeated partial
  fills can round higher than one aggregate fill and require matching covenant rules.
  This calculator is not yet used to build transactions or enforced by CatDex.
- Added a BPS orderbook indexer for Electrum UTXO batches. It checks even-index
  order/asset thread pairing, auth and PUSD categories, mutable NFT commitments,
  confirmation consistency, sell-token escrow, and open/filled status. A thin adapter
  reuses CatDex's existing `getAllMarketOrders` query. It requires the caller to supply
  the script hash and categories; it is not yet connected to a deployed PennyPicker
  covenant or the market page.
- Added a guarded order lifecycle model covering draft, unsigned, Cashonize-approved,
  broadcast, confirmed, created, discovered, matched, partially filled, filled and
  canceled states. Fill quantity only changes after a matching broadcast is confirmed;
  broadcast IDs must match the signed transaction, and cancellation requires a currently
  discovered outpoint. This state model is not yet wired to the UI or chain adapter.
- Chipnet activated BCH's May 2025 BigInt/VM-limits upgrade at height 227,228, so
  arbitrary-precision contract arithmetic is available there. The open protocol
  problem is oracle authenticity/freshness, not numeric precision. A covenant can
  verify a signed oracle statement, but a quote's age cannot be proven solely from
  its timestamp without a trustworthy current-time reference; the on-chain freshness
  design still needs a protocol decision. References: [BCHN activation-height
  documentation](https://docs.bitcoincashnode.org/doc/cli/bitcoind/) and the
  [BigInt CHIP](https://github.com/bitjson/bch-bigint).

## Next implementation order

1. Choose and review a BCH/PUSD oracle source with freshness, authenticity, outage and
   manipulation controls. Until then, keep only the development simulation.
2. Design a PennyPicker order covenant/commitment that binds asset category, side,
   quantity, BPS delta, oracle reference policy and partial-fill state. Review script
   invariants and funding/rounding before preparing a transaction builder.
3. Manually review and, if accepted, use `/penny-picker/token` to sign and broadcast
   the prepared PUSD genesis on Chipnet. Then verify the confirmed output and publish
   BCMR metadata. A local metadata draft can now be downloaded after confirmation;
   public publication still needs hosted bytes and an authenticated registry identity.
   Genesis requires an explicit user decision and wallet interaction.
4. Implement chain indexing/discovery and unsigned order creation/cancellation using
   the reviewed covenant; distinguish created, indexed, matched, signed, broadcast
   and confirmed states.
5. Connect unsigned BCH transactions to Cashonize approval and verify broadcast UTXOs.
6. Only then investigate peer-to-peer liquidation and market-priced redemption.

## Scope of this prototype

The current book and mock oracle are in-memory demonstration data. They are not shared,
not persistent, not on-chain and not safe to use for trades. PUSD is experimental and
has no promised USD value or backing.
