<script lang="ts">
	import TxFlow from '$lib/pennypicker/ui/TxFlow.svelte';
	import LiveExample from '$lib/pennypicker/ui/LiveExample.svelte';
	import { pp, explorerTx, formatAge, STALE_AFTER_SECONDS } from '$lib/pennypicker/ui/session.svelte';
	import { errorText } from '$lib/pennypicker/ui/wallet';
	import { formatPrice, GP_BCH_USD_ORACLE, oracleStateFromMessage } from '$lib/pennypicker/contracts';
	import { buildOracleGenesis, buildOracleRefresh, formatSats, type UnsignedExchangeTransaction } from '$lib/pennypicker/exchange';
	import { getOracleState, oracleAddress, ORACLE_CATEGORY_STORAGE_KEY, ORACLE_OPERATOR_STORAGE_KEY, storageKey, writeStorage } from '$lib/pennypicker/chain';
	import { MAINNET_WRITES_ENABLED } from '$lib/pennypicker/deployment';

	/** Mainnet records are created only once the build enables mainnet transactions. */
	const canWrite = $derived(pp.network === 'chipnet' || MAINNET_WRITES_ENABLED);

	let pending = $state<UnsignedExchangeTransaction | undefined>();
	let error = $state('');
	let notice = $state('');

	const oracle = $derived(pp.oracle);
	const feed = $derived(pp.feed);
	const feedState = $derived(feed ? oracleStateFromMessage(feed) : undefined);
	const operatorPkh = $derived(pp.config.oracleOperatorPkh ?? pp.wallet?.pkh);
	const exists = $derived(!!oracle);
	const recordAge = $derived(oracle ? Math.max(0, pp.nowSec - oracle.state.timestamp) : undefined);
	const feedAge = $derived(feed ? Math.max(0, pp.nowSec - feed.timestamp) : undefined);
	const behind = $derived(feed && oracle ? feed.messageSequence - oracle.state.sequence : 0);

	async function prepareGenesis() {
		error = '';
		try {
			if (!pp.wallet) throw new Error('Connect Cashonize first.');
			await Promise.all([pp.refreshWallet(), pp.refreshFeed()]);
			if (!pp.feed) throw new Error(pp.feedError || 'The oracles.cash price feed is unavailable.');
			pending = buildOracleGenesis(pp.wallet.address, pp.wallet.pkh, pp.utxos, oracleStateFromMessage(pp.feed));
		} catch (cause) {
			error = errorText(cause);
		}
	}

	async function prepareRefresh() {
		error = '';
		try {
			if (!pp.wallet || !pp.market) throw new Error('Connect a Cashonize wallet first (any wallet can do this).');
			await Promise.all([pp.refreshWallet(), pp.refreshFeed()]);
			const latest = await getOracleState(pp.market);
			if (!latest) throw new Error('Oracle state not found.');
			if (!pp.feed) throw new Error(pp.feedError || 'The oracles.cash price feed is unavailable.');
			pp.oracle = latest;
			pending = buildOracleRefresh(pp.market, latest, pp.wallet.address, pp.utxos, pp.feed);
		} catch (cause) {
			error = errorText(cause);
		}
	}

	function broadcasted(txid: string, unsigned: UnsignedExchangeTransaction) {
		if (unsigned.kind === 'oracle-genesis' && unsigned.createdCategory && pp.wallet) {
			writeStorage(storageKey(pp.network, ORACLE_CATEGORY_STORAGE_KEY), unsigned.createdCategory);
			writeStorage(storageKey(pp.network, ORACLE_OPERATOR_STORAGE_KEY), pp.wallet.pkh);
			pp.reloadConfig();
			notice = 'Oracle genesis broadcast. Its identifiers are saved in this browser; status updates once Electrum sees the transaction.';
		}
		pp.recordBroadcast(txid, unsigned);
	}
</script>

<svelte:head><title>Oracle · PennyPicker</title></svelte:head>

<div class="about-page">
	<div class="pp-page-head">
		<div>
			<h1>Reference oracle</h1>
			<p>Every order is priced against the live BCH/USD price signed by <a href="https://oracles.cash" target="_blank" rel="noopener">oracles.cash</a> (General Protocols). {pp.network === 'chipnet' ? 'PUSD stands in for a USD stablecoin, so 1 PUSD is treated as 1 USD.' : `${pp.selectedMarket.name} is a USD stablecoin, so 1 PUSD is treated as 1 USD.`}</p>
		</div>
		<button class="pp-btn pp-btn-sm" type="button" onclick={() => pp.refreshAll()} disabled={pp.loadingMarket}>{pp.loadingMarket ? 'Refreshing…' : 'Refresh'}</button>
	</div>

	<section class="pp-card familiar">
		<h2 style="margin-top: 0">If you know Pyth, you know this oracle</h2>
		<p class="lead-line">
			PennyPicker uses a <strong>pull oracle</strong>, like <a href="https://docs.pyth.network/price-feeds/pull-updates" target="_blank" rel="noopener">Pyth</a>:
			the price is signed off-chain, and whoever trades brings the newest signed update into their own transaction, where the
			contract checks the signature. The signed feed itself is the same oracles.cash BCH/USD price that
			<a href="https://anyhedge.com" target="_blank" rel="noopener">AnyHedge</a> and <a href="https://paryonusd.com" target="_blank" rel="noopener">ParyonUSD</a> already use on Bitcoin Cash.
		</p>
		<div class="pp-table-wrap">
			<table class="pp-table compare">
				<thead><tr><th></th><th><a href="https://docs.chain.link/data-feeds" target="_blank" rel="noopener">Chainlink</a> (push)</th><th><a href="https://docs.pyth.network/price-feeds" target="_blank" rel="noopener">Pyth</a> (pull)</th><th class="us">PennyPicker</th></tr></thead>
				<tbody>
					<tr><td>Who signs the price</td><td>A node network</td><td>Pyth publishers</td><td class="us">General Protocols (<a href="https://oracles.cash" target="_blank" rel="noopener">oracles.cash</a>), every minute</td></tr>
					<tr><td>How it gets on-chain</td><td>Nodes push on a schedule</td><td>The user submits the update with their transaction</td><td class="us">The trader's order or fill carries the newest message</td></tr>
					<tr><td>Checked by</td><td>The feed contract</td><td>The Pyth contract</td><td class="us">The oracle covenant, with <span class="mono">OP_CHECKDATASIG</span></td></tr>
					<tr><td>Old prices</td><td>Overwritten</td><td>Must be newer than the stored one</td><td class="us">Must be newer than the stored one</td></tr>
				</tbody>
			</table>
		</div>
	</section>

	<section class="pp-card example" style="margin-bottom: 1rem">
		<h2 style="margin-top: 0">This oracle in one example</h2>
		<LiveExample />
	</section>

	<div class="pp-grid-2">
		<section class="pp-card">
			<div class="pp-card-head">
				<h2>Live price · oracles.cash</h2>
				{#if feed}<span class="pp-badge ok">Signed</span>{:else if pp.feedError}<span class="pp-badge warn">Unavailable</span>{:else}<span class="pp-badge plain">Loading</span>{/if}
			</div>
			{#if feed && feedState}
				<div class="pp-stat-value big">{formatPrice(feedState.price)} <small>USD per BCH</small></div>
				<dl class="pp-kv" style="margin-top: 0.75rem">
					<dt>Published</dt><dd>{new Date(feed.timestamp * 1000).toLocaleString()} <span class="muted">({formatAge(feedAge)})</span></dd>
					<dt>Message</dt><dd>#{feed.messageSequence} · signature verified in this browser</dd>
					<dt>Oracle key</dt><dd class="mono small">{GP_BCH_USD_ORACLE.publicKey}</dd>
				</dl>
			{:else if pp.feedError}
				<p class="pp-callout warn small">{pp.feedError}. Trading still works at the on-chain price below.</p>
			{:else}
				<p class="muted">Loading…</p>
			{/if}

			<div class="pp-card-head" style="margin-top: 1.1rem">
				<h2>On-chain reference</h2>
				{#if exists}
					<span class="pp-badge {behind > 0 ? 'warn' : 'ok'}">{behind > 0 ? `${behind} message${behind === 1 ? '' : 's'} behind` : 'Up to date'}</span>
				{:else}
					<span class="pp-badge warn">Not created</span>
				{/if}
			</div>
			{#if oracle}
				<div class="pp-stat-value">{formatPrice(oracle.state.price)} <small>PUSD per BCH</small></div>
				<dl class="pp-kv" style="margin-top: 0.5rem">
					<dt>From message</dt><dd>#{oracle.state.sequence} · {new Date(oracle.state.timestamp * 1000).toLocaleString()} <span class="muted">({formatAge(recordAge)})</span></dd>
					<dt>Status on chain</dt><dd>{(oracle.height ?? 0) > 0 ? `Confirmed (block ${oracle.height})` : 'In mempool (unconfirmed)'}</dd>
				</dl>
				{#if behind > 0}
					<p class="small muted">New orders and fills carry the latest signed message and update this record in the same transaction, so they settle at the live price. You can also update it on its own below.</p>
				{/if}
			{:else if pp.loadingMarket && !pp.oracleLoaded}
				<p class="muted">Loading…</p>
			{:else}
				<p class="muted">No on-chain reference exists yet.</p>
			{/if}
			<details class="pp-details" style="margin-top: 0.85rem">
				<summary>Identity</summary>
				<dl class="pp-kv">
					<dt>Created by</dt><dd class="mono">{operatorPkh ?? '—'} {pp.wallet && operatorPkh === pp.wallet.pkh ? '(your wallet)' : ''}</dd>
					<dt>Oracle category</dt><dd class="mono">{pp.config.oracleCategory ?? '—'}</dd>
					{#if operatorPkh}<dt>Contract</dt><dd class="mono">{oracleAddress(operatorPkh, undefined, pp.network)}</dd>{/if}
					{#if oracle}<dt>State UTXO</dt><dd class="mono"><a href={explorerTx(oracle.txid)} target="_blank" rel="noopener">{oracle.txid}:{oracle.vout} ↗</a></dd>{/if}
				</dl>
			</details>
		</section>

		<section class="pp-card">
			<h2>How the price gets on-chain</h2>
			<ul class="ab-list">
				<li data-i="✍"><span><strong>Signed at the source.</strong> oracles.cash publishes a BCH/USD price every minute, signed by General Protocols.</span></li>
				<li data-i="✓"><span><strong>Checked by the contract.</strong> Only a valid signature from that key is accepted (<span class="mono">OP_CHECKDATASIG</span>).</span></li>
				<li data-i="⊘"><span><strong>No operator.</strong> Anyone can submit a newer signed price; nobody can type one in.</span></li>
				<li data-i="↑"><span><strong>Newer only.</strong> Each update must be newer than the last, so an old price can never be replayed against resting orders.</span></li>
				<li data-i="⏱"><span><strong>Kept fresh by trading.</strong> Orders and fills update the price in the same transaction.</span></li>
				<li data-i="$"><span><strong>PUSD = USD.</strong> {#if pp.network === 'chipnet'}PennyPickerUSD is a test token standing in for a USD stablecoin.{:else}{pp.selectedMarket.name} is a USD stablecoin, so BCH/USD is used directly.{/if}</span></li>
			</ul>
		</section>
	</div>

	{#if pending && pp.wallet}
		<TxFlow unsigned={pending} wallet={pp.wallet} onBroadcast={broadcasted} onDismiss={() => (pending = undefined)} onRebuild={() => { pending = undefined; void prepareRefresh(); }} />
	{/if}
	{#if notice}<p class="pp-callout ok">{notice}</p>{/if}
	{#if error}<p class="pp-callout bad">{error}</p>{/if}

	<section class="pp-card" style="margin-top: 1rem">
		{#if !canWrite}
			<h2>{pp.networkInfo.label} price record</h2>
			<p class="muted">{exists ? 'The on-chain record exists, but this build does not send mainnet transactions.' : `The ${pp.selectedMarket.name} market has no on-chain price record yet. Creating it is a real-money mainnet transaction done by the project owner.`} The live oracles.cash price above is what it will use.</p>
		{:else if !pp.wallet}
			<h2>Update the on-chain price</h2>
			<p class="muted">Any connected wallet can push the latest signed oracles.cash price on-chain (it pays only the network fee). <a href="/wallet">Wallet →</a></p>
		{:else if !exists && !pp.config.oracleCategory}
			<h2>Create the oracle</h2>
			<div class="pp-grid-2 action">
				<div class="pp-stack">
					<p class="small">Starts the on-chain record at the latest oracles.cash price{feedState ? ` (${formatPrice(feedState.price)})` : ''}.</p>
					<button class="pp-btn pp-btn-primary" type="button" onclick={prepareGenesis} disabled={!pp.genesisReadyUtxo || !feed || !!pending}>Review oracle creation</button>
				</div>
				<div class="pp-stack small">
					<div class="check {pp.genesisReadyUtxo ? 'ok' : 'no'}">
						{#if pp.genesisReadyUtxo}
							✓ Genesis input ready: <span class="mono">{pp.genesisReadyUtxo.txid.slice(0, 16)}…:0</span> ({formatSats(pp.genesisReadyUtxo.satoshis)} BCH)
						{:else}
							✗ Needs a BCH-only UTXO at output index 0. Receive a payment to this wallet (it lands at output 0) and refresh.
						{/if}
					</div>
					<p class="muted">Creates one mutable NFT holding the price and sends it to the oracle contract, with no minting baton. The new oracle category ID equals the spent transaction's ID.</p>
				</div>
			</div>
		{:else if !exists}
			<h2>Waiting for the oracle</h2>
			<p class="muted">An oracle category is configured (<span class="mono">{pp.config.oracleCategory?.slice(0, 16)}…</span>), but no state UTXO is visible yet. If you just broadcast genesis, refresh in a moment.</p>
		{:else}
			<h2>Update the on-chain price</h2>
			<div class="pp-grid-2 action">
				<div class="pp-stack">
					<button class="pp-btn pp-btn-primary" type="button" onclick={prepareRefresh} disabled={!feed || behind <= 0 || !!pending}>
						{behind > 0 ? 'Review price update from oracles.cash' : 'Already up to date'}
					</button>
				</div>
				<div class="small">
					{#if oracle && feedState}
						<div class="calc">
							<div><span class="muted">On-chain</span><span class="num">{formatPrice(oracle.state.price)} (#{oracle.state.sequence})</span></div>
							<div><span class="muted">oracles.cash</span><span class="num">{formatPrice(feedState.price)} (#{feed!.messageSequence})</span></div>
						</div>
					{/if}
					<p class="muted">Open orders re-price immediately: each limit is the new reference ± its BPS. Any wallet may do this; it pays only the fee.</p>
				</div>
			</div>
		{/if}
	</section>

	<section class="pp-card" style="margin-top: 1rem">
		<h2>On-chain price history</h2>
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
</div>

<style>
	.familiar { margin-bottom: 1rem; }
	.lead-line { margin: 0 0 0.75rem; line-height: 1.55; max-width: 52rem; }
	.compare td:first-child { color: var(--pp-muted); font-weight: 600; white-space: nowrap; }
	.compare .us { background: var(--pp-accent-soft); }
	.compare th.us { color: var(--pp-accent); }
	.big { font-size: 2rem; }
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
