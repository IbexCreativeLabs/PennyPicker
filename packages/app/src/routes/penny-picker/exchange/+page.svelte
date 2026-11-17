<script lang="ts">
	import TxFlow from '$lib/pennypicker/ui/TxFlow.svelte';
	import { pp, explorerTx, formatAge } from '$lib/pennypicker/ui/session.svelte';
	import { errorText, parseBch, parsePusd } from '$lib/pennypicker/ui/wallet';
	import {
		askFillUnitsDue,
		assertOrderDelta,
		bidSatsForUnits,
		formatPrice,
		limitPrice
	} from '$lib/pennypicker/contracts';
	import {
		buildCancelOrder,
		buildCreateOrder,
		buildFillOrders,
		formatSats,
		formatUnits,
		MIN_TRADE_SATOSHIS,
		quoteLeg,
		type FillLeg,
		type OpenOrder,
		type OrderSide,
		type UnsignedExchangeTransaction
	} from '$lib/pennypicker/exchange';
	import { getOracleState } from '$lib/pennypicker/chain';

	let pending = $state<UnsignedExchangeTransaction | undefined>();
	let error = $state('');
	let mode = $state<'limit' | 'take'>('limit');

	// Maker
	let side = $state<OrderSide>('ask');
	let bpsInput = $state('50');
	let amountInput = $state('0.01');

	// Taker
	let takeSide = $state<'buy' | 'sell'>('buy');
	let takeAmount = $state('0.01');
	let pinned = $state<OpenOrder | undefined>();

	const price = $derived(pp.price);
	const myPkh = $derived(pp.wallet?.pkh);
	const live = $derived((pp.discovery?.orders ?? []).filter((o) => !o.exhausted));
	const asks = $derived(live.filter((o) => o.side === 'ask').sort((a, b) => b.deltaBps - a.deltaBps));
	const bids = $derived(live.filter((o) => o.side === 'bid').sort((a, b) => b.deltaBps - a.deltaBps));
	const bestAsk = $derived(asks.at(-1));
	const bestBid = $derived(bids[0]);
	const myOrders = $derived((pp.discovery?.orders ?? []).filter((o) => o.makerPkh === myPkh));

	const bidSizeSats = (o: OpenOrder) => (price ? bidSatsForUnits(o.availableUnits, price, o.deltaBps) : 0n);
	const sizeSats = (o: OpenOrder) => (o.side === 'ask' ? o.availableSats : bidSizeSats(o));

	function setSide(next: OrderSide) {
		side = next;
		const n = Number(bpsInput);
		if (Number.isFinite(n) && n !== 0) bpsInput = String(next === 'ask' ? Math.abs(n) : -Math.abs(n));
		amountInput = next === 'ask' ? '0.01' : '5.00';
	}

	const maker = $derived.by(() => {
		if (!price) return { error: 'No reference price yet.' };
		try {
			if (!/^-?\d+$/.test(bpsInput.trim())) throw new Error('BPS must be a whole number.');
			const delta = Number(bpsInput);
			assertOrderDelta(side, delta);
			const limit = limitPrice(price, delta);
			if (side === 'ask') {
				const sats = parseBch(amountInput);
				if (sats < MIN_TRADE_SATOSHIS) throw new Error(`Minimum ask is ${formatSats(MIN_TRADE_SATOSHIS)} BCH.`);
				return { delta, limit, sats, units: askFillUnitsDue(sats, price, delta) };
			}
			const units = parsePusd(amountInput);
			if (units <= 0n) throw new Error('Enter a PUSD amount.');
			return { delta, limit, units, sats: bidSatsForUnits(units, price, delta) };
		} catch (cause) {
			return { error: errorText(cause) };
		}
	});

	const route = $derived.by(() => {
		if (!price) return undefined;
		try {
			let want = parseBch(takeAmount);
			if (want <= 0n) return undefined;
			const book = pinned ? [pinned] : takeSide === 'buy' ? [...asks].reverse() : bids;
			const legs: FillLeg[] = [];
			let units = 0n;
			let sats = 0n;
			for (const order of book) {
				if (want < MIN_TRADE_SATOSHIS) break;
				if (order.makerPkh === myPkh) continue;
				let take = sizeSats(order) < want ? sizeSats(order) : want;
				if (take < MIN_TRADE_SATOSHIS) continue;
				let quote;
				while (take >= MIN_TRADE_SATOSHIS) {
					try {
						quote = quoteLeg({ order, sats: take }, price);
						break;
					} catch {
						take -= 1n;
					}
				}
				if (!quote) continue;
				legs.push({ order, sats: take });
				units += quote.units;
				sats += take;
				want -= take;
			}
			const limits = legs.map((leg) => limitPrice(price, leg.order.deltaBps));
			return { legs, units, sats, unfilled: want, best: limits[0] ?? 0n, worst: limits[limits.length - 1] ?? 0n };
		} catch {
			return undefined;
		}
	});

	async function prepare(build: () => UnsignedExchangeTransaction) {
		error = '';
		try {
			if (!pp.wallet) throw new Error('Connect Cashonize first.');
			if (!pp.market) throw new Error('Market is not configured.');
			await pp.refreshWallet();
			const latest = await getOracleState(pp.market);
			if (!latest) throw new Error('Oracle state not found; refresh the market.');
			pp.oracle = latest;
			pending = build();
		} catch (cause) {
			error = errorText(cause);
		}
	}

	function placeOrder() {
		void prepare(() => {
			if ('error' in maker) throw new Error(maker.error);
			return buildCreateOrder(pp.market!, pp.oracle!, pp.wallet!.address, pp.wallet!.pkh, pp.utxos, {
				side,
				deltaBps: maker.delta,
				amount: side === 'ask' ? maker.sats : maker.units
			});
		});
	}

	function takeRoute() {
		const r = route;
		void prepare(() => {
			if (!r || r.legs.length === 0) throw new Error('No fillable orders for that amount.');
			return buildFillOrders(pp.market!, pp.oracle!, pp.wallet!.address, pp.utxos, r.legs);
		});
	}

	function pin(order: OpenOrder) {
		mode = 'take';
		pinned = order;
		takeSide = order.side === 'ask' ? 'buy' : 'sell';
		takeAmount = formatSats(sizeSats(order));
	}

	function cancel(order: OpenOrder) {
		void prepare(() => buildCancelOrder(pp.market!, order, pp.wallet!.address, pp.utxos));
	}

	function broadcasted(txid: string, unsigned: UnsignedExchangeTransaction) {
		pp.recordBroadcast(txid, unsigned);
		pinned = undefined;
	}

	const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;
	const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
	const quickBps = $derived(side === 'ask' ? [0, 10, 25, 50, 100] : [0, -10, -25, -50, -100]);
</script>

<svelte:head><title>Exchange · PennyPicker</title></svelte:head>

<main class="pp-container">
	<!-- Market header -->
	<section class="pp-card market">
		<div class="pair">
			<h1>BCH <span class="faint">/</span> PUSD</h1>
			<span class="small muted">Oracle-relative BPS orderbook · Chipnet</span>
		</div>
		<div class="m-stat">
			<div class="pp-stat-label">Reference</div>
			<div class="pp-stat-value">{price ? formatPrice(price) : '—'}</div>
			<div class="small muted">PUSD per BCH</div>
		</div>
		<div class="m-stat">
			<div class="pp-stat-label">Freshness</div>
			{#if pp.oracle}
				<span class="pp-badge {pp.oracleStale ? 'warn' : 'ok'}">{pp.oracleStale ? 'Stale' : 'Fresh'}</span>
				<div class="small muted">{formatAge(pp.oracleAge)} · #{pp.oracle.state.sequence}</div>
			{:else}
				<span class="pp-badge warn">No oracle</span>
			{/if}
		</div>
		<div class="m-stat">
			<div class="pp-stat-label">Best bid / ask</div>
			<div class="num">
				<span class="bid-c">{bestBid && price ? formatPrice(limitPrice(price, bestBid.deltaBps)) : '—'}</span>
				<span class="faint">/</span>
				<span class="ask-c">{bestAsk && price ? formatPrice(limitPrice(price, bestAsk.deltaBps)) : '—'}</span>
			</div>
			<div class="small muted">{bestBid ? signed(bestBid.deltaBps) : '—'} / {bestAsk ? signed(bestAsk.deltaBps) : '—'} BPS</div>
		</div>
		<button class="pp-btn pp-btn-sm" type="button" onclick={() => pp.refreshAll()} disabled={pp.loadingMarket}>{pp.loadingMarket ? 'Refreshing…' : 'Refresh'}</button>
	</section>

	{#if !pp.market}
		<p class="pp-callout warn">The market is not configured yet. Create PUSD on <a href="/penny-picker/token">Token</a> and the oracle on <a href="/penny-picker/oracle">Oracle</a>, or set <code>VITE_PENNYPICKER_*</code>.</p>
	{:else if pp.oracleLoaded && !pp.oracle}
		<p class="pp-callout warn">No oracle state found on-chain. Trading opens once the oracle is created on <a href="/penny-picker/oracle">Oracle</a>.</p>
	{:else if pp.oracleStale}
		<p class="pp-callout warn small">The reference price was published {formatAge(pp.oracleAge)}. Fills still settle at this price until the operator publishes a new one.</p>
	{/if}
	{#if pp.marketError}<p class="pp-error">{pp.marketError}</p>{/if}

	{#if pending && pp.wallet}
		<TxFlow unsigned={pending} wallet={pp.wallet} onBroadcast={broadcasted} onDismiss={() => (pending = undefined)} />
	{/if}
	{#if error}<p class="pp-callout bad">{error}</p>{/if}

	<div class="main-grid">
		<!-- Orderbook -->
		<section class="pp-card book">
			<div class="pp-card-head">
				<h2>Orderbook</h2>
				<span class="small muted">Limit = reference × (1 + BPS/10000)</span>
			</div>
			<div class="pp-table-wrap">
				<table class="pp-table">
					<thead><tr><th>BPS</th><th class="r">Price</th><th class="r">Size BCH</th><th class="r">Total PUSD</th><th></th></tr></thead>
					<tbody>
						{#each asks as order (order.address)}
							{@const l = price ? limitPrice(price, order.deltaBps) : 0n}
							<tr class="ask-row" class:mine={order.makerPkh === myPkh}>
								<td class="ask-c">{signed(order.deltaBps)}</td>
								<td class="r ask-c">{price ? formatPrice(l) : '—'}</td>
								<td class="r">{formatSats(order.availableSats)}</td>
								<td class="r muted">{price ? formatUnits(askFillUnitsDue(order.availableSats, price, order.deltaBps)) : '—'}</td>
								<td class="r">
									{#if order.makerPkh === myPkh}<span class="pp-badge plain small">yours</span>
									{:else if pp.wallet}<button class="pp-btn pp-btn-sm" type="button" onclick={() => pin(order)}>Buy</button>{/if}
								</td>
							</tr>
						{:else}
							<tr><td colspan="5" class="muted small">No asks (nobody selling BCH yet).</td></tr>
						{/each}
						<tr class="ref-row">
							<td colspan="5">
								<span>Reference <strong class="num">{price ? formatPrice(price) : '—'}</strong> PUSD/BCH</span>
								{#if bestAsk && bestBid}<span class="muted small"> · spread {bestAsk.deltaBps - bestBid.deltaBps} BPS</span>{/if}
							</td>
						</tr>
						{#each bids as order (order.address)}
							{@const l = price ? limitPrice(price, order.deltaBps) : 0n}
							<tr class="bid-row" class:mine={order.makerPkh === myPkh}>
								<td class="bid-c">{signed(order.deltaBps)}</td>
								<td class="r bid-c">{price ? formatPrice(l) : '—'}</td>
								<td class="r">{formatSats(bidSizeSats(order))}</td>
								<td class="r muted">{formatUnits(order.availableUnits)}</td>
								<td class="r">
									{#if order.makerPkh === myPkh}<span class="pp-badge plain small">yours</span>
									{:else if pp.wallet}<button class="pp-btn pp-btn-sm" type="button" onclick={() => pin(order)}>Sell</button>{/if}
								</td>
							</tr>
						{:else}
							<tr><td colspan="5" class="muted small">No bids (nobody buying BCH yet).</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if pp.discovery}
				<p class="small faint">{pp.discovery.announcedCount} orders announced · {pp.discovery.fills.length} fills · {pp.discovery.canceled.length} canceled{pp.discovery.historyTruncated ? ' · older history not scanned' : ''}</p>
			{/if}
		</section>

		<!-- Trade panel -->
		<section class="pp-card trade">
			<div class="pp-seg" role="tablist">
				<button type="button" class:on={mode === 'limit'} onclick={() => (mode = 'limit')}>Limit order</button>
				<button type="button" class:on={mode === 'take'} onclick={() => (mode = 'take')}>Trade now</button>
			</div>

			{#if !pp.wallet}
				<p class="pp-callout small" style="margin-top: 0.85rem">Connect Cashonize to trade. <a href="/penny-picker/wallet">Wallet →</a></p>
			{/if}

			{#if mode === 'limit'}
				<div class="pp-stack form">
					<div class="pp-seg">
						<button type="button" class="bid" class:on={side === 'bid'} onclick={() => setSide('bid')}>Buy BCH</button>
						<button type="button" class="ask" class:on={side === 'ask'} onclick={() => setSide('ask')}>Sell BCH</button>
					</div>
					<label class="pp-field">
						<span>Deviation from reference</span>
						<div class="pp-input-group"><input class="pp-input" inputmode="numeric" bind:value={bpsInput} /><span class="pp-addon">BPS</span></div>
					</label>
					<div class="chips">
						{#each quickBps as q}<button type="button" class="pp-btn pp-btn-sm" class:sel={String(q) === bpsInput.trim()} onclick={() => (bpsInput = String(q))}>{signed(q)}</button>{/each}
					</div>
					<label class="pp-field">
						<span>{side === 'ask' ? 'Amount of BCH to sell' : 'PUSD to spend'}</span>
						<div class="pp-input-group"><input class="pp-input" inputmode="decimal" bind:value={amountInput} /><span class="pp-addon">{side === 'ask' ? 'BCH' : 'PUSD'}</span></div>
					</label>

					{#if 'error' in maker}
						<p class="pp-error small">{maker.error}</p>
					{:else if price}
						<div class="calc">
							<div><span class="muted">Reference</span><span class="num">{formatPrice(price)}</span></div>
							<div><span class="muted">Deviation</span><span class="num">{signed(maker.delta)} BPS ({pct(maker.delta)})</span></div>
							<div class="lim"><span>Limit price now</span><strong class="num {side === 'ask' ? 'ask-c' : 'bid-c'}">{formatPrice(maker.limit, 2)} PUSD/BCH</strong></div>
							<div><span class="muted">{side === 'ask' ? 'You receive ≈' : 'You buy ≈'}</span><span class="num">{side === 'ask' ? `${formatUnits(maker.units)} PUSD` : `${formatSats(maker.sats)} BCH`}</span></div>
						</div>
						<p class="pp-hint">The limit moves with the reference: the order always trades at {pct(Math.abs(maker.delta))} {maker.delta >= 0 ? 'above' : 'below'} the latest published price.</p>
					{/if}
					<button type="button" class="pp-btn pp-btn-block {side === 'ask' ? 'pp-btn-ask' : 'pp-btn-bid'}" onclick={placeOrder} disabled={!pp.wallet || !pp.oracle || 'error' in maker}>
						Review {side === 'ask' ? 'sell' : 'buy'} order
					</button>
				</div>
			{:else}
				<div class="pp-stack form">
					<div class="pp-seg">
						<button type="button" class="bid" class:on={takeSide === 'buy'} onclick={() => { takeSide = 'buy'; pinned = undefined; }}>Buy BCH</button>
						<button type="button" class="ask" class:on={takeSide === 'sell'} onclick={() => { takeSide = 'sell'; pinned = undefined; }}>Sell BCH</button>
					</div>
					<label class="pp-field">
						<span>Amount of BCH to {takeSide}</span>
						<div class="pp-input-group"><input class="pp-input" inputmode="decimal" bind:value={takeAmount} /><span class="pp-addon">BCH</span></div>
					</label>
					{#if pinned}
						<p class="small">Filling one order at {signed(pinned.deltaBps)} BPS · <button class="pp-btn pp-btn-ghost pp-btn-sm" type="button" onclick={() => (pinned = undefined)}>use best prices instead</button></p>
					{/if}
					{#if route && route.legs.length}
						<div class="calc">
							<div><span class="muted">Orders matched</span><span class="num">{route.legs.length}</span></div>
							<div><span class="muted">Limit price</span><span class="num">{formatPrice(route.best)}{route.worst !== route.best ? ` – ${formatPrice(route.worst)}` : ''} PUSD/BCH</span></div>
							<div class="lim"><span>{takeSide === 'buy' ? 'You pay' : 'You receive'}</span><strong class="num">{formatUnits(route.units)} PUSD</strong></div>
							<div><span class="muted">{takeSide === 'buy' ? 'You receive' : 'You sell'}</span><span class="num">{formatSats(route.sats)} BCH</span></div>
						</div>
						<p class="small muted">PUSD amounts are rounded to 0.01 in the order maker's favour.</p>
						{#if route.unfilled >= MIN_TRADE_SATOSHIS}<p class="pp-callout warn small">{formatSats(route.unfilled)} BCH cannot be matched from the current book.</p>{/if}
					{:else}
						<p class="small muted">{takeSide === 'buy' ? 'No asks available to buy from.' : 'No bids available to sell into.'}</p>
					{/if}
					<p class="pp-hint">Prices settle against the reference at the moment the transaction confirms the oracle state it reads.</p>
					<button type="button" class="pp-btn pp-btn-block {takeSide === 'buy' ? 'pp-btn-bid' : 'pp-btn-ask'}" onclick={takeRoute} disabled={!pp.wallet || !pp.oracle || !route?.legs.length}>
						Review trade
					</button>
				</div>
			{/if}
		</section>
	</div>

	<!-- My orders -->
	{#if pp.wallet}
		<section class="pp-card" style="margin-top: 1rem">
			<div class="pp-card-head"><h2>My orders</h2><span class="small muted">Balances: {formatSats(pp.balances.bchSats)} BCH · {formatUnits(pp.balances.pusdUnits)} PUSD</span></div>
			<div class="pp-table-wrap">
				<table class="pp-table">
					<thead><tr><th>Side</th><th>BPS</th><th class="r">Limit now</th><th class="r">Remaining</th><th class="r">Proceeds</th><th>Status</th><th></th></tr></thead>
					<tbody>
						{#each myOrders as order (order.address)}
							<tr>
								<td class={order.side === 'ask' ? 'ask-c' : 'bid-c'}>{order.side === 'ask' ? 'Sell BCH' : 'Buy BCH'}</td>
								<td>{signed(order.deltaBps)}</td>
								<td class="r">{price ? formatPrice(limitPrice(price, order.deltaBps)) : '—'}</td>
								<td class="r">{order.side === 'ask' ? `${formatSats(order.availableSats)} BCH` : `${formatUnits(order.availableUnits)} PUSD`}</td>
								<td class="r">{order.side === 'ask' ? `${formatUnits(order.proceeds)} PUSD` : `${formatSats(order.proceeds)} BCH`}</td>
								<td>
									<span class="pp-badge {order.exhausted ? 'plain' : 'ok'}">{order.exhausted ? 'Filled' : 'Open'}</span>
									{#if (order.utxo.height ?? 0) <= 0}<span class="pp-badge warn">unconfirmed</span>{/if}
								</td>
								<td class="r"><button class="pp-btn pp-btn-sm" type="button" onclick={() => cancel(order)}>{order.exhausted ? 'Withdraw' : 'Cancel'}</button></td>
							</tr>
						{:else}
							<tr><td colspan="7" class="muted small">You have no orders on this market.</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	<!-- Activity -->
	<div class="pp-grid-2" style="margin-top: 1rem">
		<section class="pp-card">
			<h2>Your transactions</h2>
			{#each pp.history.slice(0, 8) as record (record.txid)}
				<div class="tx">
					<span class="pp-badge {record.status === 'confirmed' ? 'ok' : record.status === 'broadcast' ? 'warn' : 'plain'}">{record.status}</span>
					<span class="grow"><strong>{record.kind}</strong><br /><span class="small muted">{record.summary[0]}</span></span>
					<a class="small" href={explorerTx(record.txid)} target="_blank" rel="noopener">{record.txid.slice(0, 8)}… ↗</a>
				</div>
			{:else}
				<p class="small muted">Nothing yet. Transactions you broadcast from this browser appear here.</p>
			{/each}
		</section>
		<section class="pp-card">
			<h2>Market fills</h2>
			{#each (pp.discovery?.fills ?? []).slice(0, 8) as fill (fill.txid)}
				<div class="tx">
					<span class="pp-badge {fill.height > 0 ? 'ok' : 'warn'}">{fill.height > 0 ? `block ${fill.height}` : 'mempool'}</span>
					<span class="grow mono small">{fill.txid}</span>
					<a class="small" href={explorerTx(fill.txid)} target="_blank" rel="noopener">↗</a>
				</div>
			{:else}
				<p class="small muted">No fills observed on this market yet.</p>
			{/each}
		</section>
	</div>
</main>

<style>
	.market { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem 2rem; margin-bottom: 1rem; }
	.pair { margin-right: auto; }
	.pair h1 { font-size: 1.5rem; }
	.m-stat { min-width: 7rem; }
	.m-stat .pp-stat-value { font-size: 1.4rem; }
	.main-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(18rem, 1fr); gap: 1rem; align-items: start; }
	@media (max-width: 900px) { .main-grid { grid-template-columns: 1fr; } }
	.trade { position: sticky; top: 7rem; }
	@media (max-width: 900px) { .trade { position: static; } }
	.form { margin-top: 0.9rem; }
	.chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
	.chips .sel { border-color: var(--pp-accent); color: var(--pp-accent); }
	.calc { border: 1px solid var(--pp-border); border-radius: var(--pp-radius-sm); padding: 0.6rem 0.75rem; background: var(--pp-surface-2); font-size: 0.9rem; }
	.calc > div { display: flex; justify-content: space-between; gap: 0.5rem; padding: 0.15rem 0; }
	.calc .lim { border-top: 1px dashed var(--pp-border-strong); border-bottom: 1px dashed var(--pp-border-strong); margin: 0.25rem 0; padding: 0.35rem 0; }
	.ask-c { color: var(--pp-ask); }
	.bid-c { color: var(--pp-bid); }
	tr.ask-row td:first-child { box-shadow: inset 3px 0 0 var(--pp-ask-soft); }
	tr.bid-row td:first-child { box-shadow: inset 3px 0 0 var(--pp-bid-soft); }
	tr.mine { background: var(--pp-accent-soft); }
	tr.ref-row td { background: var(--pp-surface-2); text-align: center; padding: 0.55rem; }
	.tx { display: flex; gap: 0.6rem; align-items: center; padding: 0.45rem 0; border-bottom: 1px solid var(--pp-border); }
	.tx:last-child { border-bottom: 0; }
	.grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
</style>
