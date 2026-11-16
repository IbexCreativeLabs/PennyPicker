<script lang="ts">
	import { onMount } from 'svelte';
	import TxFlow from '$lib/pennypicker/ui/TxFlow.svelte';
	import {
		balancesOf,
		connectCashonize,
		errorText,
		formatPusdPerBch,
		parseBch,
		parsePusd,
		type Balances,
		type ConnectedWallet
	} from '$lib/pennypicker/ui/wallet';
	import {
		discoverOrders,
		getAddressUtxos,
		getOracleState,
		isCompleteMarket,
		loadMarketConfig,
		loadTxHistory,
		ORACLE_CATEGORY_STORAGE_KEY,
		ORACLE_OPERATOR_STORAGE_KEY,
		saveTxHistory,
		transactionHeight,
		writeStorage,
		type TxRecord
	} from '$lib/pennypicker/chain';
	import { PUSD_CATEGORY_STORAGE_KEY } from '$lib/pennypicker/pusdGenesis';
	import {
		buildCancelOrder,
		buildCreateOrder,
		buildFillOrders,
		quoteLeg,
		type ChainUtxo,
		type FillLeg,
		type MarketConfig,
		type OpenOrder,
		type OracleUtxo,
		type UnsignedExchangeTransaction
	} from '$lib/pennypicker/exchange';
	import { buyFillTakeSats } from '$lib/pennypicker/contracts';
	import { formatBchFromSatoshis, formatPusd, rateAtDeltaBps, type OrderSide } from '$lib/pennypicker/market';

	const STALE_AFTER_SECONDS = 15 * 60;

	let config = $state(loadMarketConfig());
	let market = $derived<MarketConfig | undefined>(isCompleteMarket(config) ? config : undefined);
	let wallet = $state<ConnectedWallet | undefined>();
	let walletUtxos = $state<ChainUtxo[]>([]);
	let balances = $state<Balances | undefined>();
	let oracle = $state<OracleUtxo | undefined>();
	let orders = $state<OpenOrder[]>([]);
	let discoveryNote = $state('');
	let pending = $state<UnsignedExchangeTransaction | undefined>();
	let history = $state<TxRecord[]>([]);
	let loading = $state(false);
	let error = $state('');
	let nowSec = $state(Math.floor(Date.now() / 1000));

	// Manual configuration (when env/local values are missing).
	let cfgPusd = $state('');
	let cfgOracle = $state('');
	let cfgOperator = $state('');

	// Maker form.
	let side = $state<OrderSide>('sell-pusd');
	let deltaInput = $state('50');
	let qtyInput = $state('10.00');
	let escrowInput = $state('');

	// Taker form.
	let takeSide = $state<'buy' | 'sell'>('buy');
	let takeQtyInput = $state('1.00');
	let fillInputs = $state<Record<string, string>>({});

	const rate = $derived(oracle?.state.rateSatsPerPusdScaled);
	const oracleAge = $derived(oracle ? nowSec - oracle.state.timestamp : undefined);
	const oracleStale = $derived(oracleAge !== undefined && oracleAge > STALE_AFTER_SECONDS);

	const limitOf = (order: OpenOrder) => (rate ? rateAtDeltaBps(rate, order.deltaBps) : 0n);
	const asks = $derived(
		orders.filter((o) => o.side === 'sell-pusd' && o.remainingUnits > 0n).sort((a, b) => a.deltaBps - b.deltaBps)
	);
	const bids = $derived(
		orders.filter((o) => o.side === 'buy-pusd' && o.remainingUnits > 0n).sort((a, b) => b.deltaBps - a.deltaBps)
	);
	const myOrders = $derived(wallet ? orders.filter((o) => o.makerPkh === wallet!.pkh) : []);

	const makerPreview = $derived.by(() => {
		if (!rate) return undefined;
		try {
			const delta = Number(deltaInput);
			const units = parsePusd(qtyInput);
			const limit = rateAtDeltaBps(rate, delta);
			const cost = units > 0n ? buyFillTakeSats(units, rate, delta) : 0n;
			return { limit, cost, suggestedEscrow: cost + cost / 10n + 2_000n };
		} catch {
			return undefined;
		}
	});

	/** Greedy best-price route for a taker quantity across one side of the book. */
	const takerRoute = $derived.by(() => {
		if (!rate) return undefined;
		try {
			let want = parsePusd(takeQtyInput);
			if (want <= 0n) return undefined;
			const book = takeSide === 'buy' ? asks : bids;
			const legs: FillLeg[] = [];
			let sats = 0n;
			for (const order of book) {
				if (want === 0n) break;
				if (wallet && order.makerPkh === wallet.pkh) continue;
				let units = order.remainingUnits < want ? order.remainingUnits : want;
				// Buy orders may not have enough BCH escrow left at the current price.
				while (units > 0n) {
					try {
						sats += quoteLeg({ order, units }, rate).satoshis;
						break;
					} catch {
						units = units / 2n;
					}
				}
				if (units === 0n) continue;
				legs.push({ order, units });
				want -= units;
			}
			return { legs, sats, unfilled: want };
		} catch {
			return undefined;
		}
	});

	onMount(() => {
		config = loadMarketConfig();
		cfgPusd = config.pusdCategory ?? '';
		cfgOracle = config.oracleCategory ?? '';
		cfgOperator = config.oracleOperatorPkh ?? '';
		history = loadTxHistory();
		void refreshMarket();
		const timer = setInterval(() => (nowSec = Math.floor(Date.now() / 1000)), 5_000);
		return () => clearInterval(timer);
	});

	function saveConfig() {
		writeStorage(PUSD_CATEGORY_STORAGE_KEY, cfgPusd.trim().toLowerCase());
		writeStorage(ORACLE_CATEGORY_STORAGE_KEY, cfgOracle.trim().toLowerCase());
		writeStorage(ORACLE_OPERATOR_STORAGE_KEY, cfgOperator.trim().toLowerCase());
		config = loadMarketConfig();
		void refreshMarket();
	}

	async function connect() {
		error = '';
		try {
			wallet = await connectCashonize();
			await refreshWallet();
		} catch (cause) {
			error = errorText(cause);
		}
	}

	async function refreshWallet() {
		if (!wallet) return;
		walletUtxos = await getAddressUtxos(wallet.address);
		balances = balancesOf(walletUtxos, market?.pusdCategory);
	}

	async function refreshBalancesClicked() {
		error = '';
		try {
			await refreshWallet();
		} catch (cause) {
			error = `Balance query failed: ${errorText(cause)}`;
		}
	}

	async function refreshMarket() {
		if (!market) return;
		loading = true;
		error = '';
		try {
			oracle = await getOracleState(market);
			const result = await discoverOrders(market);
			orders = result.orders;
			discoveryNote = `${result.orders.length} open, ${result.closed.length} closed; scanned ${result.scannedTransactions} oracle transactions${result.historyTruncated ? ' (older history truncated)' : ''}.`;
			await refreshWallet();
			await refreshHistory();
		} catch (cause) {
			error = errorText(cause);
		} finally {
			loading = false;
		}
	}

	async function refreshHistory() {
		if (!wallet) return;
		let changed = false;
		for (const record of history.filter((r) => r.status !== 'confirmed').slice(0, 10)) {
			const height = await transactionHeight(wallet.address, record.txid);
			const status = height === undefined ? 'unknown' : height > 0 ? 'confirmed' : 'broadcast';
			if (status !== record.status) {
				record.status = status;
				changed = true;
			}
		}
		if (changed) {
			history = [...history];
			saveTxHistory(history);
		}
	}

	function requireReady(): { market: MarketConfig; oracle: OracleUtxo; wallet: ConnectedWallet } {
		if (!market) throw new Error('Market is not configured.');
		if (!wallet) throw new Error('Connect Cashonize first.');
		if (!oracle) throw new Error('No oracle state found.');
		return { market, oracle, wallet };
	}

	async function prepare(build: (ctx: ReturnType<typeof requireReady>) => UnsignedExchangeTransaction) {
		error = '';
		try {
			const ctx = requireReady();
			// Rebuild against fresh UTXOs and the latest oracle state.
			await refreshWallet();
			const latest = await getOracleState(ctx.market);
			if (!latest) throw new Error('Oracle state disappeared; refresh the market.');
			oracle = latest;
			pending = build({ ...ctx, oracle: latest });
		} catch (cause) {
			error = errorText(cause);
		}
	}

	function placeOrder() {
		void prepare(({ market, oracle, wallet }) =>
			buildCreateOrder(market, oracle, wallet.address, wallet.pkh, walletUtxos, {
				side,
				deltaBps: Number(deltaInput),
				quantityUnits: parsePusd(qtyInput),
				escrowSatoshis: side === 'buy-pusd' ? parseBch(escrowInput || formatBchFromSatoshis(makerPreview?.suggestedEscrow ?? 0n)) : undefined
			})
		);
	}

	function takeRoute() {
		const route = takerRoute;
		if (!route || route.legs.length === 0) {
			error = 'No fillable orders for that quantity.';
			return;
		}
		void prepare(({ market, oracle, wallet }) => buildFillOrders(market, oracle, wallet.address, walletUtxos, route.legs));
	}

	function fillOne(order: OpenOrder) {
		void prepare(({ market, oracle, wallet }) => {
			const units = parsePusd(fillInputs[order.address] ?? formatPusd(order.remainingUnits));
			return buildFillOrders(market, oracle, wallet.address, walletUtxos, [{ order, units }]);
		});
	}

	function cancel(order: OpenOrder) {
		void prepare(({ market, wallet }) => buildCancelOrder(market, order, wallet.address, walletUtxos));
	}

	function broadcasted(txid: string, unsigned: UnsignedExchangeTransaction) {
		history = [{ txid, kind: unsigned.kind, summary: unsigned.summary, at: Date.now(), status: 'broadcast' }, ...history];
		saveTxHistory(history);
		setTimeout(refreshMarket, 2_500);
	}

	function short(text: string, n = 10) {
		return text.length > n * 2 ? `${text.slice(0, n + 8)}…${text.slice(-n)}` : text;
	}
</script>

<svelte:head><title>PennyPicker exchange (Chipnet)</title></svelte:head>

<main>
	<header>
		<h1>PennyPicker — BCH/PUSD BPS orderbook <small>Chipnet</small></h1>
		<nav>
			<a href="/penny-picker">Simulator</a> · <a href="/penny-picker/token">PUSD token</a> ·
			<a href="/penny-picker/oracle">Oracle operator</a> · <a href="/penny-picker/mechanisms">Liquidation &amp; redemption</a> ·
			<a href="/cashonize">Cashonize</a>
		</nav>
	</header>
	<p class="notice">
		Experimental on-chain prototype on BCH <strong>Chipnet</strong>. PUSD is a fixed-supply test token with no USD backing or
		peg. Prices are an operator-attested reference, not a market feed. Every transaction is built unsigned, shown to you,
		signed only in Cashonize, and broadcast only when you press Broadcast.
	</p>

	{#if !market}
		<section class="panel">
			<h2>Market configuration</h2>
			<p>
				The market is identified by the PUSD category, the oracle category and the oracle operator's key hash. Set them via
				<code>VITE_PENNYPICKER_*</code> env vars, create them on the token and oracle pages, or paste them here.
			</p>
			<label>PUSD category <input bind:value={cfgPusd} size="66" /></label>
			<label>Oracle category <input bind:value={cfgOracle} size="66" /></label>
			<label>Oracle operator PKH <input bind:value={cfgOperator} size="42" /></label>
			<button type="button" onclick={saveConfig}>Save to this browser</button>
		</section>
	{/if}

	<div class="grid">
		<section class="panel">
			<h2>Reference price</h2>
			{#if oracle && rate}
				<p class="big">{formatPusdPerBch(rate)} <small>PUSD per BCH</small></p>
				<p>{formatBchFromSatoshis((rate + 50_000_000n) / 100_000_000n)} BCH per PUSD · seq #{oracle.state.sequence}</p>
				<p class:stale={oracleStale}>
					Published {oracleAge}s ago by operator{oracleStale ? ' — STALE: fills still use this price; consider waiting for an update' : ''}
					· {(oracle.height ?? 0) > 0 ? 'confirmed' : 'unconfirmed'}
				</p>
			{:else if market}
				<p>{loading ? 'Loading…' : 'No oracle state found. Trading is disabled until one exists.'}</p>
			{:else}
				<p>Not configured.</p>
			{/if}
			<button type="button" onclick={refreshMarket} disabled={loading || !market}>{loading ? 'Refreshing…' : 'Refresh market'}</button>
			{#if discoveryNote}<p class="hint">{discoveryNote}</p>{/if}
		</section>

		<section class="panel">
			<h2>Wallet</h2>
			{#if wallet}
				<p><code>{wallet.address}</code></p>
				{#if balances}
					<p>BCH {formatBchFromSatoshis(balances.bchSats)} <small>({formatBchFromSatoshis(balances.bchSats - balances.bchConfirmedSats)} pending)</small></p>
					<p>PUSD {formatPusd(balances.pusdUnits)} <small>({formatPusd(balances.pusdUnits - balances.pusdConfirmedUnits)} pending)</small></p>
					<p><small>{balances.bchUtxoCount} BCH-only UTXO(s); {balances.tokenUtxoCount} token UTXO(s) carrying {formatBchFromSatoshis(balances.tokenUtxoSats)} BCH (not spendable as plain BCH)</small></p>
				{/if}
				<button type="button" onclick={refreshBalancesClicked}>Refresh balances</button>
			{:else}
				<button type="button" onclick={connect}>Use connected Cashonize wallet</button>
				<p class="hint">Create the session on <a href="/cashonize">/cashonize</a>.</p>
			{/if}
		</section>
	</div>

	{#if pending && wallet}
		<TxFlow unsigned={pending} {wallet} onBroadcast={broadcasted} onDismiss={() => (pending = undefined)} />
	{/if}
	{#if error}<p class="error">{error}</p>{/if}

	<section class="panel">
		<h2>Orderbook</h2>
		<p class="hint">Limit = reference × (10000 + BPS) / 10000, re-evaluated at every fill against the current oracle state.</p>
		<div class="book">
			{#each [{ title: 'Asks — sell PUSD (take to buy PUSD)', list: asks }, { title: 'Bids — buy PUSD (take to sell PUSD)', list: bids }] as half}
				<div>
					<h3>{half.title}</h3>
					<table>
						<thead><tr><th>BPS</th><th>Limit PUSD/BCH</th><th>Remaining PUSD</th><th>Order holds</th><th></th></tr></thead>
						<tbody>
							{#each half.list as order (order.address)}
								<tr class:mine={wallet && order.makerPkh === wallet.pkh}>
									<td>{order.deltaBps > 0 ? '+' : ''}{order.deltaBps}</td>
									<td>{rate ? formatPusdPerBch(limitOf(order)) : '—'}</td>
									<td>{formatPusd(order.remainingUnits)}</td>
									<td>{formatBchFromSatoshis(order.utxo.satoshis)} BCH{order.heldUnits > 0n ? ` + ${formatPusd(order.heldUnits)} PUSD` : ''}{(order.utxo.height ?? 0) > 0 ? '' : ' (unconf.)'}</td>
									<td>
										{#if wallet && order.makerPkh === wallet.pkh}
											<button type="button" onclick={() => cancel(order)}>Cancel</button>
										{:else if wallet}
											<input class="qty" placeholder={formatPusd(order.remainingUnits)} bind:value={fillInputs[order.address]} />
											<button type="button" onclick={() => fillOne(order)} disabled={!oracle}>Fill</button>
										{/if}
									</td>
								</tr>
							{:else}
								<tr><td colspan="5" class="hint">No open orders.</td></tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/each}
		</div>
	</section>

	{#if wallet && market}
		<div class="grid">
			<section class="panel">
				<h2>Place order (maker)</h2>
				<label><input type="radio" bind:group={side} value="sell-pusd" /> Sell PUSD (premium, BPS ≥ 0)</label>
				<label><input type="radio" bind:group={side} value="buy-pusd" /> Buy PUSD (discount, BPS ≤ 0)</label>
				<label>BPS from reference <input bind:value={deltaInput} size="8" /></label>
				<label>Quantity (PUSD) <input bind:value={qtyInput} size="12" /></label>
				{#if side === 'buy-pusd'}
					<label>BCH escrow <input bind:value={escrowInput} size="14" placeholder={makerPreview ? formatBchFromSatoshis(makerPreview.suggestedEscrow) : ''} /></label>
					<p class="hint">Escrow must cover the quantity at the reference price at fill time; the suggestion adds 10% headroom. Unused BCH is returned on cancel.</p>
				{/if}
				{#if makerPreview}
					<p>Limit now: <strong>{formatPusdPerBch(makerPreview.limit)} PUSD/BCH</strong>; {side === 'sell-pusd' ? 'you would receive' : 'you would pay'} ≈ {formatBchFromSatoshis(makerPreview.cost)} BCH at the current reference.</p>
				{/if}
				<button type="button" onclick={placeOrder} disabled={!oracle}>Prepare order</button>
			</section>

			<section class="panel">
				<h2>Trade now (taker)</h2>
				<label><input type="radio" bind:group={takeSide} value="buy" /> Buy PUSD with BCH</label>
				<label><input type="radio" bind:group={takeSide} value="sell" /> Sell PUSD for BCH</label>
				<label>Quantity (PUSD) <input bind:value={takeQtyInput} size="12" /></label>
				{#if takerRoute}
					<p>
						{takerRoute.legs.length} order(s), {takeSide === 'buy' ? 'pay' : 'receive'} ≈ {formatBchFromSatoshis(takerRoute.sats)} BCH
						{#if takerRoute.unfilled > 0n}<br /><span class="stale">{formatPusd(takerRoute.unfilled)} PUSD cannot be filled from the book.</span>{/if}
					</p>
				{/if}
				<button type="button" onclick={takeRoute} disabled={!oracle}>Prepare trade</button>
			</section>
		</div>

		<section class="panel">
			<h2>My orders</h2>
			{#each myOrders as order (order.address)}
				<p>
					{order.side === 'sell-pusd' ? 'Sell' : 'Buy'} {formatPusd(order.targetUnits)} PUSD @ {order.deltaBps} BPS — remaining {formatPusd(order.remainingUnits)},
					holds {formatBchFromSatoshis(order.utxo.satoshis)} BCH + {formatPusd(order.heldUnits)} PUSD
					<button type="button" onclick={() => cancel(order)}>Cancel &amp; withdraw</button>
				</p>
			{:else}
				<p class="hint">None.</p>
			{/each}
		</section>
	{/if}

	<section class="panel">
		<h2>Transaction history (this browser)</h2>
		{#each history as record (record.txid)}
			<p><strong>{record.kind}</strong> <code>{short(record.txid)}</code> — {record.status} · {new Date(record.at).toLocaleString()}<br /><small>{record.summary[0]}</small></p>
		{:else}
			<p class="hint">No transactions yet.</p>
		{/each}
	</section>
</main>

<style>
	main { max-width: 72rem; margin: 0 auto; padding: 1rem; }
	header nav { font-size: 0.9rem; }
	.notice { background: #fff4d6; border-left: 4px solid #c08a1e; padding: 0.75rem; }
	.panel { border: 1px solid #ddd; border-radius: 0.5rem; padding: 0.75rem 1rem; margin: 0.75rem 0; background: #fff; }
	.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); gap: 0 1rem; }
	.book { display: grid; grid-template-columns: repeat(auto-fit, minmax(28rem, 1fr)); gap: 1rem; overflow-x: auto; }
	table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
	th, td { text-align: left; padding: 0.25rem 0.4rem; border-bottom: 1px solid #eee; }
	tr.mine { background: #eef6ff; }
	.qty { width: 5rem; }
	.big { font-size: 1.8rem; margin: 0.25rem 0; }
	.stale { color: #a35200; font-weight: 600; }
	.hint { font-size: 0.85rem; color: #555; }
	.error { color: #a00; }
	label { display: block; margin: 0.3rem 0; }
	code { word-break: break-all; }
</style>
