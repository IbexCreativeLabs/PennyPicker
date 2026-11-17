<script lang="ts">
	import TxFlow from '$lib/pennypicker/ui/TxFlow.svelte';
	import { pp, explorerTx, formatAge, STALE_AFTER_SECONDS } from '$lib/pennypicker/ui/session.svelte';
	import { errorText } from '$lib/pennypicker/ui/wallet';
	import { formatPrice, parsePrice } from '$lib/pennypicker/contracts';
	import { buildOracleGenesis, buildOracleUpdate, formatSats, type UnsignedExchangeTransaction } from '$lib/pennypicker/exchange';
	import { getOracleState, oracleAddress, ORACLE_CATEGORY_STORAGE_KEY, ORACLE_OPERATOR_STORAGE_KEY, writeStorage } from '$lib/pennypicker/chain';

	let priceInput = $state('500.00');
	let pending = $state<UnsignedExchangeTransaction | undefined>();
	let error = $state('');
	let notice = $state('');

	const oracle = $derived(pp.oracle);
	const operatorPkh = $derived(pp.config.oracleOperatorPkh ?? pp.wallet?.pkh);
	const exists = $derived(!!oracle);
	const canOperate = $derived(!!pp.wallet && (!pp.config.oracleOperatorPkh || pp.config.oracleOperatorPkh === pp.wallet.pkh));
	const parsed = $derived.by(() => {
		try {
			return { price: parsePrice(priceInput) };
		} catch (cause) {
			return { error: errorText(cause) };
		}
	});
	const change = $derived(
		oracle && 'price' in parsed && parsed.price
			? Number(((parsed.price - oracle.state.price) * 1_000_000n) / oracle.state.price) / 10_000
			: undefined
	);

	async function prepareGenesis() {
		error = '';
		try {
			if (!pp.wallet) throw new Error('Connect Cashonize first.');
			if ('error' in parsed) throw new Error(parsed.error);
			await pp.refreshWallet();
			pending = buildOracleGenesis(pp.wallet.address, pp.wallet.pkh, pp.utxos, {
				price: parsed.price!,
				timestamp: Math.floor(Date.now() / 1000),
				sequence: 1
			});
		} catch (cause) {
			error = errorText(cause);
		}
	}

	async function prepareUpdate() {
		error = '';
		try {
			if (!pp.wallet || !pp.market) throw new Error('Connect the operator wallet first.');
			if ('error' in parsed) throw new Error(parsed.error);
			await pp.refreshWallet();
			const latest = await getOracleState(pp.market);
			if (!latest) throw new Error('Oracle state not found.');
			pp.oracle = latest;
			pending = buildOracleUpdate(pp.market, latest, pp.wallet.address, pp.utxos, {
				price: parsed.price!,
				timestamp: Math.max(Math.floor(Date.now() / 1000), latest.state.timestamp),
				sequence: latest.state.sequence + 1
			});
		} catch (cause) {
			error = errorText(cause);
		}
	}

	function broadcasted(txid: string, unsigned: UnsignedExchangeTransaction) {
		if (unsigned.kind === 'oracle-genesis' && unsigned.createdCategory && pp.wallet) {
			// Identifiers come from the broadcast transaction itself; status is still derived from chain data.
			writeStorage(ORACLE_CATEGORY_STORAGE_KEY, unsigned.createdCategory);
			writeStorage(ORACLE_OPERATOR_STORAGE_KEY, pp.wallet.pkh);
			pp.reloadConfig();
			notice = 'Oracle genesis broadcast. Its identifiers are saved in this browser; status updates once Electrum sees the transaction.';
		}
		pp.recordBroadcast(txid, unsigned);
	}
</script>

<svelte:head><title>Oracle · PennyPicker</title></svelte:head>

<main class="pp-container">
	<div class="pp-page-head">
		<div>
			<h1>Reference oracle</h1>
			<p>The BCH/PUSD reference price every order is priced against, published on-chain by the oracle operator.</p>
		</div>
		<button class="pp-btn pp-btn-sm" type="button" onclick={() => pp.refreshAll()} disabled={pp.loadingMarket}>{pp.loadingMarket ? 'Refreshing…' : 'Refresh'}</button>
	</div>

	<div class="pp-grid-2">
		<section class="pp-card">
			<div class="pp-card-head">
				<h2>Current reference</h2>
				{#if exists}
					<span class="pp-badge {pp.oracleStale ? 'warn' : 'ok'}">{pp.oracleStale ? 'Stale' : 'Live'}</span>
				{:else}
					<span class="pp-badge warn">Not created</span>
				{/if}
			</div>
			{#if oracle}
				<div class="pp-stat-value big">{formatPrice(oracle.state.price)} <small>PUSD per BCH</small></div>
				<dl class="pp-kv" style="margin-top: 0.75rem">
					<dt>Last update</dt><dd>{new Date(oracle.state.timestamp * 1000).toLocaleString()} <span class="muted">({formatAge(pp.oracleAge)})</span></dd>
					<dt>Freshness</dt><dd>{pp.oracleStale ? `Older than ${STALE_AFTER_SECONDS / 60} min: shown as stale` : `Within ${STALE_AFTER_SECONDS / 60} min`}</dd>
					<dt>Sequence</dt><dd>#{oracle.state.sequence}</dd>
					<dt>Status on chain</dt><dd>{(oracle.height ?? 0) > 0 ? `Confirmed (block ${oracle.height})` : 'In mempool (unconfirmed)'}</dd>
				</dl>
			{:else if pp.loadingMarket && !pp.oracleLoaded}
				<p class="muted">Loading…</p>
			{:else}
				<p class="muted">No oracle exists yet. Creating it publishes the first reference price.</p>
			{/if}
			<details class="pp-details" style="margin-top: 0.85rem">
				<summary>Identity</summary>
				<dl class="pp-kv">
					<dt>Operator PKH</dt><dd class="mono">{operatorPkh ?? '—'} {pp.wallet && operatorPkh === pp.wallet.pkh ? '(your wallet)' : ''}</dd>
					<dt>Oracle category</dt><dd class="mono">{pp.config.oracleCategory ?? (pp.genesisReadyUtxo ? `${pp.genesisReadyUtxo.txid} (after genesis)` : '—')}</dd>
					{#if operatorPkh}<dt>Contract</dt><dd class="mono">{oracleAddress(operatorPkh)}</dd>{/if}
					{#if oracle}<dt>State UTXO</dt><dd class="mono"><a href={explorerTx(oracle.txid)} target="_blank" rel="noopener">{oracle.txid}:{oracle.vout} ↗</a></dd>{/if}
				</dl>
			</details>
		</section>

		<section class="pp-card">
			<h2>How this oracle works</h2>
			<ul class="facts">
				<li><strong>What it does.</strong> It holds one on-chain record with the BCH/PUSD reference price. Every order fill must read it.</li>
				<li><strong>Why PennyPicker needs it.</strong> Orders are stored as BPS deviations, not prices. The covenant needs a reference to turn BPS into a limit price at fill time.</li>
				<li><strong>Who controls it.</strong> Only the operator address can publish a price. Here that is the wallet that created the oracle.</li>
				<li><strong>Manual price.</strong> The operator types the price in. The oracle does <em>not</em> check it against any real market, and PUSD is not USD.</li>
				<li><strong>Latest price only.</strong> Each update spends the previous record, so fills can only use the most recent price.</li>
				<li><strong>Freshness.</strong> The chain cannot see wall-clock time, so the app marks the price stale after 15 minutes. Fills still settle at it until a new price is published.</li>
			</ul>
		</section>
	</div>

	{#if pending && pp.wallet}
		<TxFlow unsigned={pending} wallet={pp.wallet} onBroadcast={broadcasted} onDismiss={() => (pending = undefined)} />
	{/if}
	{#if notice}<p class="pp-callout ok">{notice}</p>{/if}
	{#if error}<p class="pp-callout bad">{error}</p>{/if}

	<section class="pp-card" style="margin-top: 1rem">
		{#if !pp.wallet}
			<h2>Operator actions</h2>
			<p class="muted">Connect the operator's Cashonize wallet to create the oracle or publish prices. <a href="/penny-picker/wallet">Wallet →</a></p>
		{:else if !exists && !pp.config.oracleCategory && !canOperate}
			<h2>Oracle not created yet</h2>
			<p class="muted">Only the operator (<span class="mono">{pp.config.oracleOperatorPkh?.slice(0, 12)}…</span>) can create the oracle. Trading opens once it exists. This page updates automatically when it appears on Chipnet.</p>
		{:else if !exists && !pp.config.oracleCategory}
			<h2>Create the oracle</h2>
			<div class="pp-grid-2 action">
				<div class="pp-stack">
					<label class="pp-field">
						<span>Initial reference price</span>
						<div class="pp-input-group"><input class="pp-input" inputmode="decimal" bind:value={priceInput} /><span class="pp-addon">PUSD per BCH</span></div>
					</label>
					{#if 'error' in parsed}<p class="pp-error small">{parsed.error}</p>{/if}
					<button class="pp-btn pp-btn-primary" type="button" onclick={prepareGenesis} disabled={!pp.genesisReadyUtxo || 'error' in parsed || !!pending}>Review oracle creation</button>
				</div>
				<div class="pp-stack small">
					<div class="check {pp.genesisReadyUtxo ? 'ok' : 'no'}">
						{#if pp.genesisReadyUtxo}
							✓ Genesis input ready: <span class="mono">{pp.genesisReadyUtxo.txid.slice(0, 16)}…:0</span> ({formatSats(pp.genesisReadyUtxo.satoshis)} BCH, confirmed)
						{:else}
							✗ Needs a BCH-only UTXO at output index 0. Receive a payment to this wallet (it lands at output 0) and refresh.
						{/if}
					</div>
					<p class="muted">Creates one mutable NFT holding the price and sends it to the oracle contract, with no minting baton. The new oracle category ID equals the spent transaction's ID. You become the operator.</p>
				</div>
			</div>
		{:else if !exists}
			<h2>Waiting for the oracle</h2>
			<p class="muted">An oracle category is configured (<span class="mono">{pp.config.oracleCategory?.slice(0, 16)}…</span>), but no state UTXO is visible yet. If you just broadcast genesis, refresh in a moment.</p>
		{:else if canOperate}
			<h2>Publish a new reference price</h2>
			<div class="pp-grid-2 action">
				<div class="pp-stack">
					<label class="pp-field">
						<span>New reference price</span>
						<div class="pp-input-group"><input class="pp-input" inputmode="decimal" bind:value={priceInput} /><span class="pp-addon">PUSD per BCH</span></div>
					</label>
					{#if 'error' in parsed}<p class="pp-error small">{parsed.error}</p>{/if}
					<button class="pp-btn pp-btn-primary" type="button" onclick={prepareUpdate} disabled={'error' in parsed || !!pending}>Review price update</button>
				</div>
				<div class="small">
					{#if oracle && 'price' in parsed}
						<div class="calc">
							<div><span class="muted">Current</span><span class="num">{formatPrice(oracle.state.price)}</span></div>
							<div><span class="muted">New</span><span class="num">{formatPrice(parsed.price!)}</span></div>
							<div><span class="muted">Change</span><span class="num">{change !== undefined ? `${change > 0 ? '+' : ''}${change.toFixed(2)}%` : '—'}</span></div>
							<div><span class="muted">Sequence</span><span class="num">#{oracle.state.sequence} → #{oracle.state.sequence + 1}</span></div>
						</div>
					{/if}
					<p class="muted">Open orders re-price immediately: each limit is the new reference ± its BPS. The update is authorised by an ordinary input from your operator address.</p>
				</div>
			</div>
		{:else}
			<h2>Operator actions</h2>
			<p class="muted">The connected wallet is not this oracle's operator, so prices are read-only here.</p>
		{/if}
	</section>

	<section class="pp-card" style="margin-top: 1rem">
		<h2>Price history</h2>
		{#each pp.discovery?.oracleUpdates ?? [] as update (update.state.sequence)}
			<div class="row">
				<span class="mono small">#{update.state.sequence}</span>
				<strong class="num">{formatPrice(update.state.price)}</strong>
				<span class="muted small grow">{new Date(update.state.timestamp * 1000).toLocaleString()}</span>
				<span class="pp-badge {update.height > 0 ? 'ok' : 'warn'}">{update.height > 0 ? `block ${update.height}` : 'mempool'}</span>
				<a class="small" href={explorerTx(update.txid)} target="_blank" rel="noopener">tx ↗</a>
			</div>
		{:else}
			<p class="small muted">{exists ? 'History appears after the next refresh.' : 'No prices published yet.'}</p>
		{/each}
	</section>
</main>

<style>
	.big { font-size: 2rem; }
	.facts { margin: 0; padding-left: 1.1rem; font-size: 0.92rem; }
	.facts li { margin: 0.35rem 0; }
	.action { margin-top: 0.75rem; align-items: start; }
	.check { padding: 0.5rem 0.65rem; border-radius: var(--pp-radius-sm); }
	.check.ok { background: var(--pp-bid-soft); }
	.check.no { background: var(--pp-warn-soft); }
	.calc { border: 1px solid var(--pp-border); border-radius: var(--pp-radius-sm); padding: 0.6rem 0.75rem; background: var(--pp-surface-2); margin-bottom: 0.5rem; }
	.calc > div { display: flex; justify-content: space-between; padding: 0.1rem 0; }
	.row { display: flex; align-items: center; gap: 0.75rem; padding: 0.45rem 0; border-bottom: 1px solid var(--pp-border); flex-wrap: wrap; }
	.row:last-child { border-bottom: 0; }
	.grow { flex: 1; }
</style>
