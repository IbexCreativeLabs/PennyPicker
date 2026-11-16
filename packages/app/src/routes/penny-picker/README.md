# BCH/PUSD BPS market prototype

Open `/penny-picker` for the local market simulation. Orders, cancels, and fills exist
only in page memory. The visible DEVELOPMENT MOCK quote is an arithmetic fixture, not
an oracle observation or market price. Nothing is written to the blockchain.

Rates in the market module are fixed-point satoshis per whole PUSD with a 1e8 scale.
PUSD quantities use integer CashToken base units (100 units per PUSD). Signed BPS
deltas adjust the BCH/PUSD limit from the reference; positive deltas raise the limit
and negative deltas lower it. BCH output amounts round upward to whole satoshis.
Order quantities are bounded by the CashTokens signed-int64 amount limit, and
simulated BCH quotes cannot exceed BCH's maximum monetary supply.

The un-deployed order commitment draft is version 2 and 34 bytes:
`version:u8 | side:u8 | remaining PUSD units:u64le | delta BPS:i32le | maker P2PKH HASH160:20 bytes`.
The maker hash is included so a future shared-script covenant can authorize
cancellation by the order owner. PennyPicker extracts it from a prefixed Chipnet
P2PKH public address; P2SH and non-Chipnet addresses are rejected. This encoding is
not enforced by CatDex and must not be used to create an on-chain order until its
matching covenant is implemented and reviewed.

The order-funding planner is arithmetic only. It requires a fresh authenticated
quote bound to the expected PUSD category and explicit dust and fee reserves,
estimates BCH escrow for buy orders, and requires the full PUSD quantity for sell
orders. It does not build or submit a transaction.

PUSD is an experimental token with no backing or promised USD peg. The page must not
be used for trade decisions. Production use needs a reviewed covenant that binds the
oracle and BPS order terms, a fresh authenticated BCH/PUSD oracle, a deployed PUSD
category, a chain order indexer, and explicit Cashonize transaction approval.

The separate `/penny-picker/token` route can prepare the 1,000,000 PUSD CashToken
genesis from a connected Cashonize Chipnet address using a watch-only Vox wallet. If
there is no confirmed BCH-only vout 0, it can prepare a one-input self-transfer with
one BCH-only output at vout 0. Signing and broadcasting each require separate buttons;
WalletConnect signing requests use `broadcast: false`. The route verifies transaction
inputs, output script/value, category, supply and hash, then checks the resulting UTXO
and confirmation. Genesis has not been run. The category before confirmation is only a
candidate, and BCMR metadata still requires publication.
