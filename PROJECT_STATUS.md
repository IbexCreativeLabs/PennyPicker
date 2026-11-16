# PennyPicker — project status

_Last updated: 2026-11-16. Hackathon deadline: 2026-11-22._

PennyPicker is an experimental BCH/PUSD orderbook DEX on **BCH Chipnet** in which
orders are priced as basis-point deviations from an on-chain oracle reference.
PUSD is a fixed-supply test token (1,000,000 PUSD, 2 decimals). It has no USD
backing or peg. `PENNYPICKER_PROGRESS.md` holds the earlier research log.

## What works (code complete, tested in the BCH VM, not yet run on Chipnet)

| Area | Where | Status |
| --- | --- | --- |
| Order covenant (BPS limit order) | `packages/app/src/lib/pennypicker/contracts/PennyPickerOrder.cash` | Compiled (cashc 0.11.5); 18 VM checks |
| Oracle-state covenant | `contracts/PennyPickerOracle.cash` | Compiled; VM tested |
| Tx builders: oracle genesis/update, order create/fill/cancel | `lib/pennypicker/exchange.ts` | 16 end-to-end VM checks with signed, chained txs |
| Chain I/O: oracle state, order discovery, broadcast | `lib/pennypicker/chain.ts` | Untested against a live Electrum server |
| Exchange UI | `/penny-picker/exchange` | Renders; wallet flows need manual testing |
| Oracle operator UI | `/penny-picker/oracle` | Renders; needs manual testing |
| PUSD genesis UI (earlier work) | `/penny-picker/token` | Prepared earlier; not yet broadcast |
| Liquidation / redemption pricing | `lib/pennypicker/mechanisms.ts`, `/penny-picker/mechanisms` | Simulation over the live or demo book; 8 checks |
| BPS math, local matching simulator | `lib/pennypicker/market.ts`, `/penny-picker` | Earlier work |

Run the tests from `packages/app`:

```
pnpm dlx tsx scripts/pennypicker-contracts.test.ts
pnpm dlx tsx scripts/pennypicker-exchange.test.ts
pnpm dlx tsx scripts/pennypicker-mechanisms.test.ts
```

## Architecture

**Units.** PUSD amounts are in base units (100 per PUSD). BCH amounts are in satoshis. The oracle
rate is **satoshis per whole PUSD × 1e8**, stored as an integer. PUSD per BCH is `1e16 / rate`.

**BPS convention.** Limit = `rate × (10000 + deltaBps) / 10000`.
- Sell-PUSD orders (asks) use `deltaBps ≥ 0`: the maker asks for at least the reference.
- Buy-PUSD orders (bids) use `deltaBps ≤ 0`: the maker pays at most the reference.
- The contract also accepts deltas of the "wrong" sign. That is only an aggressive price, never a loss of escrow. The app rejects them.

**Oracle (`PennyPickerOracle`).**
- A single mutable NFT, of a category with no minting baton, is locked in the oracle contract.
- Its commitment is `rate:int64le | timestamp:int32le | sequence:int32le`.
- `update` requires the operator's signature and a strictly increasing sequence.
- `read` lets anyone spend the oracle UTXO, provided it is recreated byte-for-byte.
- Fills and order creation must spend the oracle at input 0. A superseded price is therefore a spent output, and fills can only use the **latest published** price.

**Order (`PennyPickerOrder`).** One P2SH32 address per order. Constructor parameters are oracle category, PUSD category, maker PKH, side, deltaBps and targetUnits.
- Escrow and proceeds live in one UTXO, which continues at the same input/output index after each fill.
- The settlement check is exact, with no rounding in the contract: `dSat × 1e14 + dUnits × rate × (10000 + deltaBps) ≥ 0`.
- Off-chain, the taker pays `ceil(...)` when buying from an ask and takes `floor(...)` when selling into a bid.
- Buy orders cap accumulated PUSD at `targetUnits`. Sell orders can only release PUSD.
- `cancel` lets the maker withdraw everything with their key.

**Discovery.**
- An order-creation tx reads the oracle and includes an OP_RETURN announcement: `"PPKR" | v1 | side | deltaBps | targetUnits | makerPkh`.
- The indexer scans the oracle address history and re-derives each order's contract address from the announced parameters. A forged announcement cannot point at a different script.
- It then lists each address's UTXOs.
- Only standard Electrum calls are needed; there is no indexer server.

**Signing.**
- Builders return an unsigned tx plus libauth source outputs.
- Wallet P2PKH inputs carry empty unlocking bytecode.
- Contract inputs that need a signature (cancel, oracle update) carry CashScript's 65-byte signature and 33-byte pubkey zero placeholders, plus `contract` info, as defined by wc2-bch-bcr.
- `TxFlow.svelte`:
  1. Shows the preview.
  2. Calls `bch_signTransaction` with `broadcast: false`.
  3. Checks the signed tx has the same outpoints and outputs as the preview.
  4. Broadcasts only after an explicit click.

## Important decisions and assumptions

- **CatDex is not reused on-chain.** Its two-UTXO order/asset pairing is bound only by input position, and its baton holder can bypass the rules. With a single fungible category, one UTXO can hold both escrow and proceeds, so parameters live in the script and no NFT state is needed.
- **The oracle is operator-attested.** No authenticated BCH/PUSD market feed exists for a new test token, and BCH/USD is not BCH/PUSD. The operator key (initially your Cashonize key) is a trusted party, and the UI says so.
- **On-chain freshness is not enforced.** BCH script cannot observe the current time. The guarantee is "latest published state". The UI flags prices older than 15 minutes. A stale price is the main economic risk for makers.
- **Buy-order escrow can run short.** Escrow is in BCH. If the reference rises, the escrow may cover less than `targetUnits`. Takers then fill less, and the UI's router shrinks the quantity accordingly.
- **Liquidation and redemption are pricing designs, not a protocol.** The ask book serves as the competing liquidation offers, and the bid book as the redemption market. There is no vault covenant, because fixed-supply PUSD has no minting authority.

## Known limitations

- Nothing has been signed or broadcast on Chipnet yet. Cashonize's handling of contract-input placeholders follows the spec but is **unverified in practice**.
- Order creation and fills all spend the single oracle UTXO. Concurrent transactions from different users conflict, and the loser must rebuild. Unconfirmed chaining works.
- Discovery scans only the last 300 oracle-history transactions and makes one request per announced order.
- The fee estimate is about 1 sat/byte, using a fixed P2PKH signature allowance.
- Transaction history is stored per browser (localStorage).
- The older modules `orderCommitment.ts`, `orderbookIndex.ts`, `electrumOrderbook.ts`, `orderLifecycle.ts` and `executionOracle.ts` belong to the earlier NFT-commitment design. They are superseded by `contracts.ts`, `exchange.ts` and `chain.ts`. `makerPkhFromChipnetAddress` is still used.
- No independent security review of the covenants has been done.

## External actions required from you (in order)

1. **Push the backup.** Commits are local because `git push ibex-backup main` failed with no GitHub credentials in this shell. Run `! git push ibex-backup main` after authenticating (for example `gh auth login`).
2. **Fund the Cashonize Chipnet address** from a Chipnet faucet.
3. **PUSD genesis.** On `/penny-picker/token`, run the self-transfer if needed, then genesis. You sign and broadcast it yourself.
4. **Oracle genesis.** On `/penny-picker/oracle`, enter a reference price (PUSD per BCH) and prepare genesis. This needs another BCH-only vout-0 UTXO, so repeat the self-transfer first. Then sign and broadcast.
5. Optionally, put the three identifiers in `packages/app/.env` (`VITE_PENNYPICKER_*`) so other browsers see the same market.
6. **Manual testing.** On `/penny-picker/exchange`:
   - Place a sell order and a buy order.
   - Fill them from a second Cashonize wallet.
   - Cancel an order.
   - Publish an oracle update and re-check the limit prices.

## Remaining tasks

- Run the flow on Chipnet and fix whatever Cashonize or Electrum reveal.
- Optionally maintain a market-wide order list (for example, persist discovered orders) to reduce Electrum calls.
- Allow multi-order fills that mix sides (crossing two makers directly).
- Polish: explorer links, confirmation polling, price chart.
- A vault covenant, if liquidation and redemption should become on-chain.
