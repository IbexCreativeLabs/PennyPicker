# BCH/PUSD BPS market prototype

Open `/penny-picker` for the local market simulation. Orders, cancels, and fills exist
only in page memory. The visible DEVELOPMENT MOCK quote is an arithmetic fixture, not
an oracle observation or market price. Nothing is written to the blockchain.

Rates in the market module are fixed-point satoshis per whole PUSD with a 1e8 scale.
PUSD quantities use integer CashToken base units (100 units per PUSD). Signed BPS
deltas adjust the BCH/PUSD limit from the reference; positive deltas raise the limit
and negative deltas lower it. BCH output amounts round upward to whole satoshis.

PUSD is an experimental token with no backing or promised USD peg. The page must not
be used for trade decisions. Production use needs a reviewed covenant that binds the
oracle and BPS order terms, a fresh authenticated BCH/PUSD oracle, a deployed PUSD
category, a chain order indexer, and explicit Cashonize transaction approval.
