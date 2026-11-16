<script lang="ts">
	import { onMount } from 'svelte';
	import {
		assertFreshOracle,
		createOrder,
		formatBchFromSatoshis,
		formatPusd,
		formatRate,
		matchOrders,
		rateAtDeltaBps,
		type BpsOrderDraft,
		type OracleObservation,
		type OrderSide
	} from '$lib/pennypicker/market';
	import { DevelopmentMockOracle } from '$lib/pennypicker/oracle';
	import { TestNetWatchWallet, type Utxo } from '@unspent/wallet';
	import {
		createCashonizeClient,
		getApprovedChipnetSession,
		requestChipnetAddresses
	} from '$lib/cashonize/walletconnect';
	import { PUSD_CATEGORY_STORAGE_KEY } from '$lib/pennypicker/pusdGenesis';

	const mockOracle = new DevelopmentMockOracle();
	let oracle = $state<OracleObservation | undefined>();
	let orders = $state<BpsOrderDraft[]>([]);
	let side = $state<OrderSide>('buy-pusd');
	let deltaBpsInput = $state('0');
	let quantityInput = $state('100.00');
	let error = $state('');
	let latestFills = $state<ReturnType<typeof matchOrders>['fills']>([]);
	let simulationSequence = 0;
	let connectedAddress = $state('');
	let walletUtxos = $state<Utxo[]>([]);
	let walletLoading = $state(false);
	let walletError = $state('');
	let pusdCategory = $state('');
	let balanceCategory = $state(0n);
	let balanceSatoshis = $state(0n);
	let balanceConfirmedSatoshis = $state(0n);
	let balancePendingSatoshis = $state(0n);
	let balanceBchOnly = $state(0n);
	let balanceConfirmedBchOnly = $state(0n);
	let balancePendingBchOnly = $state(0n);
	let balanceConfirmedCategory = $state(0n);
	let balancePendingCategory = $state(0n);

	function isConfirmedUtxo(utxo: Utxo): boolean {
		return Number.isSafeInteger(utxo.height) && (utxo.height ?? 0) > 0;
	}

	function decimalToUnits(value: string): bigint {
		const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
		if (!match) throw new Error('Enter a non-negative PUSD quantity with at most 2 decimals.');
		return BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
	}

	function priceFor(order: BpsOrderDraft): bigint {
		if (!oracle) return 0n;
		const bps = BigInt(order.deltaBps);
		return (oracle.rateSatsPerPusdScaled * (10_000n + bps)) / 10_000n;
	}

	function seedDemoBook(observation: OracleObservation) {
		const now = Date.now();
		orders = [
			createOrder({ id: 'demo-buy-1', side: 'buy-pusd', deltaBps: -100, quantityUnits: 25_000n }, observation, now - 2_000),
			createOrder({ id: 'demo-buy-2', side: 'buy-pusd', deltaBps: -25, quantityUnits: 15_000n }, observation, now - 1_000),
			createOrder({ id: 'demo-sell-1', side: 'sell-pusd', deltaBps: 75, quantityUnits: 20_000n }, observation, now - 1_500),
			createOrder({ id: 'demo-sell-2', side: 'sell-pusd', deltaBps: 150, quantityUnits: 30_000n }, observation, now - 500)
		];
	}

	onMount(async () => {
		oracle = await mockOracle.getLatest();
		seedDemoBook(oracle);
		pusdCategory = localStorage.getItem(PUSD_CATEGORY_STORAGE_KEY) ?? '';
	});

	async function loadWalletBalances() {
		walletLoading = true;
		walletError = '';
		try {
			const client = await createCashonizeClient();
			const session = getApprovedChipnetSession(client);
			if (!session) throw new Error('Connect Cashonize on BCH Chipnet first.');
			const addresses = await requestChipnetAddresses(client, session);
			connectedAddress = addresses[0] ?? '';
			if (!connectedAddress) throw new Error('Cashonize returned no Chipnet address.');
			const wallet = await TestNetWatchWallet.watchOnly(connectedAddress);
			walletUtxos = await wallet.getUtxos();
			pusdCategory = localStorage.getItem(PUSD_CATEGORY_STORAGE_KEY) ?? '';
			balanceSatoshis = walletUtxos.reduce((sum, utxo) => sum + utxo.satoshis, 0n);
			balanceConfirmedSatoshis = walletUtxos
				.filter(isConfirmedUtxo)
				.reduce((sum, utxo) => sum + utxo.satoshis, 0n);
			balancePendingSatoshis = balanceSatoshis - balanceConfirmedSatoshis;
			balanceBchOnly = walletUtxos
				.filter((utxo) => !utxo.token)
				.reduce((sum, utxo) => sum + utxo.satoshis, 0n);
			balanceConfirmedBchOnly = walletUtxos
				.filter((utxo) => !utxo.token && isConfirmedUtxo(utxo))
				.reduce((sum, utxo) => sum + utxo.satoshis, 0n);
			balancePendingBchOnly = balanceBchOnly - balanceConfirmedBchOnly;
			balanceCategory = pusdCategory
				? walletUtxos
					.filter((utxo) => utxo.token?.category === pusdCategory)
					.reduce((sum, utxo) => sum + (utxo.token?.amount ?? 0n), 0n)
				: 0n;
			balanceConfirmedCategory = pusdCategory
				? walletUtxos
					.filter((utxo) => utxo.token?.category === pusdCategory && isConfirmedUtxo(utxo))
					.reduce((sum, utxo) => sum + (utxo.token?.amount ?? 0n), 0n)
				: 0n;
			balancePendingCategory = balanceCategory - balanceConfirmedCategory;
		} catch (cause) {
			walletError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			walletLoading = false;
		}
	}

	const buyOrders = $derived(
		orders.filter((order) => order.side === 'buy-pusd' && order.remainingUnits > 0n)
			.sort((a, b) => priceFor(a) > priceFor(b) ? -1 : priceFor(a) < priceFor(b) ? 1 : a.createdAtMs - b.createdAtMs)
	);
	const sellOrders = $derived(
		orders.filter((order) => order.side === 'sell-pusd' && order.remainingUnits > 0n)
			.sort((a, b) => priceFor(a) < priceFor(b) ? -1 : priceFor(a) > priceFor(b) ? 1 : a.createdAtMs - b.createdAtMs)
	);
	const estimatedRate = $derived.by(() => {
		if (!oracle || !/^-?\d+$/.test(deltaBpsInput)) return undefined;
		try {
			return rateAtDeltaBps(oracle.rateSatsPerPusdScaled, Number(deltaBpsInput));
		} catch {
			return undefined;
		}
	});

	function addOrder() {
		try {
			if (!oracle) throw new Error('Oracle fixture is loading.');
			assertFreshOracle(oracle);
			const delta = Number(deltaBpsInput);
			if (!Number.isSafeInteger(delta)) throw new Error('BPS delta must be a whole number.');
			simulationSequence++;
			orders = [...orders, createOrder({
				id: `local-${Date.now()}-${simulationSequence}`,
				side,
				deltaBps: delta,
				quantityUnits: decimalToUnits(quantityInput)
			}, oracle)];
			latestFills = [];
			error = '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	function cancelOrder(id: string) {
		orders = orders.filter((order) => order.id !== id);
		latestFills = [];
	}

	function simulateMatching() {
		try {
			if (!oracle) throw new Error('Oracle fixture is loading.');
			const result = matchOrders(orders, oracle);
			orders = result.remaining;
			latestFills = result.fills;
			error = '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}
</script>

<svelte:head>
	<title>BCH/PUSD BPS Market Prototype | PennyPicker</title>
	<meta name="description" content="Experimental BCH/PUSD basis-point orderbook prototype on Chipnet." />
</svelte:head>

<main>
	<header>
		<p class="eyebrow">PENNYPICKER · BCH CHIPNET</p>
		<h1>BCH/PUSD market prototype</h1>
		<p class="warning"><strong>Local simulation only.</strong> PennyPicker PUSD is experimental, has no USD backing or guaranteed peg, and is a separate token from ParyonUSD, which also uses the PUSD ticker on BCH. Always identify a token by its category, not its ticker. Orders on this page are held only in this browser session; no order has been published to the chain.</p>
	</header>

	<section class="market-card" aria-label="Market reference">
		<div>
			<span class="label">Reference rate</span>
			<strong>{oracle ? formatRate(oracle.rateSatsPerPusdScaled) : 'Loading…'} sats / PUSD</strong>
			<span class="muted">{oracle ? formatBchFromSatoshis(oracle.rateSatsPerPusdScaled / 100_000_000n) : ''} BCH per PUSD (display approximation)</span>
		</div>
		<div class="oracle-status">
			<span class="status-dot"></span>
			<div><strong>DEVELOPMENT MOCK</strong><br /><span>{oracle?.source ?? 'Initializing fixture'}</span></div>
		</div>
	</section>

	<p class="bps-note"><strong>BPS convention:</strong> 1 BPS = 0.01%. The signed delta raises or lowers the limit price from the current BCH/PUSD reference for either side. A buy at −100 BPS pays 1% below reference; a sell at +100 BPS asks 1% above. Matching re-prices deltas against the latest observation and uses the older resting order’s limit price.</p>

	<section class="wallet-card">
		<div class="section-heading"><div><h2>Cashonize wallet</h2><span class="muted">Public read-only Chipnet balances</span></div>
			<button type="button" onclick={loadWalletBalances} disabled={walletLoading}>{walletLoading ? 'Loading…' : 'Load wallet balances'}</button>
		</div>
		{#if connectedAddress}
			<p><strong>Connected address:</strong> <code>{connectedAddress}</code></p>
			<p><strong>Confirmed BCH:</strong> {formatBchFromSatoshis(balanceConfirmedSatoshis)} BCH ({balanceConfirmedSatoshis.toString()} sats)</p>
			<p><strong>Pending BCH:</strong> {formatBchFromSatoshis(balancePendingSatoshis)} BCH ({balancePendingSatoshis.toString()} sats)</p>
			<p><strong>Confirmed BCH-only UTXOs:</strong> {formatBchFromSatoshis(balanceConfirmedBchOnly)} BCH</p>
			<p><strong>Pending BCH-only UTXOs:</strong> {formatBchFromSatoshis(balancePendingBchOnly)} BCH</p>
			{#if pusdCategory}
				<p><strong>Confirmed PUSD:</strong> {formatPusd(balanceConfirmedCategory)} PUSD</p>
				<p><strong>Pending PUSD:</strong> {formatPusd(balancePendingCategory)} PUSD</p>
				<p class="muted">Category: <code>{pusdCategory}</code></p>
			{:else}
				<p><strong>PUSD balance:</strong> Category not registered on this browser; complete and verify genesis first.</p>
			{/if}
			<p class="muted">{walletUtxos.length} UTXOs read. Vox created only a watch-only address reader.</p>
		{:else}
			<p>Connect at <a href="/cashonize">/cashonize</a>, then load your public address and balances here.</p>
		{/if}
		{#if walletError}<p class="error" role="alert">{walletError}</p>{/if}
	</section>

	<section class="order-entry">
		<h2>Create a local order</h2>
		<div class="form-grid">
			<label>Direction
				<select bind:value={side}>
					<option value="buy-pusd">Buy PUSD with BCH</option>
					<option value="sell-pusd">Sell PUSD for BCH</option>
				</select>
			</label>
			<label>Oracle delta (BPS)
				<input type="number" step="1" min="-9999" max="1000000" bind:value={deltaBpsInput} />
			</label>
			<label>Quantity (PUSD)
				<input inputmode="decimal" bind:value={quantityInput} />
			</label>
			<button class="primary" type="button" onclick={addOrder}>Add simulated order</button>
		</div>
		{#if estimatedRate}
			<p class="estimate">Current limit estimate: <strong>{formatRate(estimatedRate)} sats/PUSD</strong>. BCH totals round upward to the next satoshi.</p>
		{/if}
	</section>

	<section class="book-section">
		<div class="section-heading"><div><h2>Open orderbook</h2><span class="muted">Browser-local demo orders · no chain indexer connected</span></div>
			<button type="button" onclick={simulateMatching} disabled={!oracle}>Simulate matching</button>
		</div>
		<div class="book-columns">
			<div><h3>Buy PUSD</h3><table><thead><tr><th>Delta</th><th>Limit</th><th>Remaining</th><th></th></tr></thead><tbody>
				{#each buyOrders as order (order.id)}
					<tr><td>{order.deltaBps} BPS</td><td>{formatRate(priceFor(order))}</td><td>{formatPusd(order.remainingUnits)}</td><td><button class="link-button" onclick={() => cancelOrder(order.id)}>Cancel</button></td></tr>
				{:else}<tr><td colspan="4" class="muted">No open buy orders.</td></tr>{/each}
			</tbody></table></div>
			<div><h3>Sell PUSD</h3><table><thead><tr><th>Delta</th><th>Limit</th><th>Remaining</th><th></th></tr></thead><tbody>
				{#each sellOrders as order (order.id)}
					<tr><td>{order.deltaBps} BPS</td><td>{formatRate(priceFor(order))}</td><td>{formatPusd(order.remainingUnits)}</td><td><button class="link-button" onclick={() => cancelOrder(order.id)}>Cancel</button></td></tr>
				{:else}<tr><td colspan="4" class="muted">No open sell orders.</td></tr>{/each}
			</tbody></table></div>
		</div>
	</section>

	{#if latestFills.length > 0}
		<section class="fills"><h2>Simulated fills</h2><p>These are arithmetic results only; no transaction was constructed, signed, broadcast or confirmed.</p>
			{#each latestFills as fill (`${fill.buyOrderId}:${fill.sellOrderId}:${fill.quantityUnits}`)}
				<p>{formatPusd(fill.quantityUnits)} PUSD at {formatRate(fill.priceSatsPerPusdScaled)} sats/PUSD · {fill.bchSatoshis.toString()} sat BCH</p>
			{/each}
		</section>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<section class="next-work"><h2>On-chain status</h2>
		<p><strong><a href="/penny-picker/exchange">Open the on-chain Chipnet exchange</a></strong>: real covenant orders priced against the on-chain oracle state. This page remains a local, in-memory simulator.</p>
		<p><a href="/penny-picker/token">Prepare PUSD fixed-supply Chipnet genesis</a> uses a watch-only address and separates preparation, Cashonize signing, broadcast and UTXO verification.</p>
		<ul>
		<li>Cashonize Chipnet address and read-only balance loading are available above.</li>
		<li>PUSD category is stored locally only after a confirmed genesis UTXO is verified. Creating it requires explicit Cashonize review and approval.</li>
		<li>CatDex currently stores a fixed absolute price in its order NFT. It cannot enforce this market’s oracle-relative BPS pricing; an updated contract schema and covenant review are required.</li>
		<li>No authenticated BCH/PUSD oracle provider is configured. This demo feed must never be used to publish or execute orders.</li>
	</ul></section>
</main>

<style>
	main { max-width: 70rem; margin: 0 auto; padding: 1.25rem; }
	header { margin: 1rem 0 1.5rem; }
	h1 { margin: 0.15rem 0 0.75rem; font-size: clamp(1.8rem, 4vw, 2.7rem); }
	h2 { margin-top: 0; }
	.eyebrow, .label { font-size: 0.78rem; letter-spacing: 0.08em; color: #4d4052; }
	.warning { background: #fff2d7; border-left: 4px solid #bc7610; padding: 0.8rem 1rem; }
	.market-card, .wallet-card, .order-entry, .book-section, .fills, .next-work { margin: 1rem 0; padding: 1rem; background: #ffffffc9; border-radius: 0.7rem; }
	.market-card { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 1rem; align-items: center; }
	.market-card > div:first-child { display: grid; gap: 0.3rem; }
	.oracle-status { display: flex; align-items: center; gap: 0.65rem; font-size: 0.9rem; }
	.status-dot { width: 0.75rem; height: 0.75rem; border-radius: 50%; background: #c87f14; }
	.muted { color: #5f5862; font-size: 0.88rem; }
	.bps-note { padding: 0.8rem 0; }
	.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: 0.8rem; align-items: end; }
	label { display: grid; gap: 0.35rem; font-size: 0.9rem; }
	input, select, button { min-height: 2.5rem; padding: 0.45rem 0.65rem; border: 1px solid #95869a; border-radius: 0.35rem; background: white; }
	button { cursor: pointer; }
	button:disabled { cursor: not-allowed; opacity: 0.55; }
	.primary { background: #57265f; color: white; border-color: #57265f; }
	.estimate { margin-bottom: 0; }
	.section-heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem; }
	.section-heading h2 { margin-bottom: 0.2rem; }
	.book-columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); gap: 1rem; }
	table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
	th, td { text-align: left; padding: 0.5rem 0.25rem; border-bottom: 1px solid #d5cdd7; }
	.link-button { min-height: auto; border: 0; background: transparent; color: #702880; padding: 0.2rem; }
	.error { color: #9b1515; }
	.fills { border-left: 4px solid #5b873e; }
	.next-work li { margin: 0.5rem 0; }
</style>
