# Security review (internal)

**Date:** 2026-11-18
**Scope:**
- `PennyPickerOrder.cash` and `PennyPickerOracle.cash` (CashScript 0.11.5)
- the transaction builders in `packages/app/src/lib/pennypicker/exchange.ts`
- the signing and broadcast flow (`TxFlow.svelte`, `chain.ts`, `walletconnect.ts`)

**Reviewer:** the project's AI developer (Claude). This is **not** an independent audit. An external review is still
required before mainnet trading with meaningful amounts. Until then, mainnet orders are capped at 25 PUSD
(`MAINNET_MAX_ORDER_UNITS`) and mainnet transactions are switched off (`MAINNET_WRITES_ENABLED = false`).

## Result

The review found no way to take funds from an order or to fake the reference price. The findings below are economic
or availability risks plus one wallet-safety improvement, which is fixed.

## What was checked

| Property | How it holds | Test |
|---|---|---|
| Only the oracle's signed price can be used | `update()` checks the oracles.cash Schnorr signature (`OP_CHECKDATASIG`) and writes exactly the signed price. | forged signature, altered price, different price written |
| Old prices cannot be replayed | Each update must carry a higher message sequence than the stored one. A superseded record is a spent output. | replay of same sequence |
| The price record cannot be faked or moved | The order requires the oracle category's *mutable* NFT at input 0 and output 0. Genesis mints exactly one mutable NFT and no minting baton, so no second one can exist. Both oracle functions keep the NFT in the same contract, with the same capability and token amount, and with no less value. | wrong category; immutable NFT; NFT moved by `update` or `read`; downgraded to immutable; value drained; order at input 0 |
| Every fill pays at least the limit | Exact integer settlement `dUnits·1e18 + dSat·price·(10000+bps) ≥ 0`, read from output 0 (so an in-transaction refresh is priced correctly). BigInt arithmetic (BCH 2025 VM) cannot overflow. | 1 unit short; 1 unit too many; refreshed fill cannot pay the old price |
| Fills cannot run backwards or redirect funds | Asks must gain PUSD and bids must lose PUSD. The continuation must stay at the same index and address, in the right token category. Per-index outputs mean one payment cannot satisfy two orders. | reverse trades; wrong token; redirected continuation |
| Only the maker can cancel | `cancel()` requires the maker's own P2PKH input right after the order. The maker's wallet signature (SIGHASH_ALL) commits to every output. | other address; maker input in the wrong position |
| The wallet signs what the user saw | `verifySignedMatchesUnsigned` rejects a signed transaction whose inputs, outputs, version or locktime differ from the preview, or whose hash differs from the wallet's report. | — |
| User tokens are never spent by accident | BCH funding uses BCH-only coins. Stablecoin inputs use fungible-only coins, so NFTs such as ParyonUSD loan NFTs are never touched. Token identity outputs are held back, and every builder checks token conservation. | identity safeguards |
| No mainnet transaction by mistake | `MAINNET_WRITES_ENABLED = false` blocks signing (TxFlow) and broadcasting (`chain.ts`). Mainnet orders are capped in both the builder and the form. | mainnet suite |

## Findings

### 1. Stale-price pick-off in quiet markets (economic, medium–high for mainnet)
The chain cannot see the clock. A taker may fill against the stored price, or against any signed message newer
than it, so when the market has been idle while BCH moved, a taker can trade against resting orders at an outdated
price. No covenant can prove *how recent* a price is, because locktime only proves a lower bound on time.

**Mitigation before mainnet:**
- Run a keeper that pushes each new oracles.cash message (about one per minute). Updates are permissionless,
  cost about 300 sats, and keep the window to about a minute.
- Tell makers that resting orders carry this risk.

The UI marks prices older than 15 minutes as stale and always bundles the newest message into new orders and fills.

### 2. Contention and griefing on the single price record (availability, medium)
Every order, fill and update spends the one oracle output. Concurrent users conflict and must rebuild. Anyone can
also spend it with `read()` (paying fees) to force others to rebuild. No funds are at risk.

**Mitigation:** retry automatically on conflict. For scale, shard the price state across several records.

### 3. Token-creator coins on mainnet (wallet safety, low) — fixed
On mainnet the app cannot know which output-0 coins in a user's wallet anchor the identity of tokens the user
created. Coin selection now spends output-0 coins only as a last resort.

### 4. Maker-only footguns (informational)
- The contract accepts any `side` value and asks with negative BPS. The app never builds these, and they can only
  hurt the maker who chose them.
- Anyone may send extra coins to an order address. Those coins become fillable or cancellable like the order.
  Discovery ignores UTXOs carrying unexpected tokens.

### 5. Trust assumptions (informational)
- **Oracle:** prices come from General Protocols (oracles.cash), the same oracle ParyonUSD relies on.
- **Wallet:** Cashonize must sign with SIGHASH_ALL, which it does.
- **Discovery:** the orderbook is read from a public Electrum server. A dishonest server can hide orders but cannot
  forge them: order addresses are re-derived from the announced terms, and any transaction built from false data
  fails the covenants.
