<script lang="ts">
	import { pp } from '$lib/pennypicker/ui/session.svelte';
	import { MARKETS } from '$lib/pennypicker/deployment';
	import { formatSats, formatUnits } from '$lib/pennypicker/exchange';
	import { NETWORKS } from '$lib/pennypicker/network';

	const market = $derived(pp.selectedMarket);
	const explorer = (network: keyof typeof NETWORKS, category: string) => NETWORKS[network].explorerTx(category);
	const statusLabel = (m: typeof market) => `${NETWORKS[m.network].label} · ${m.status === 'live' ? 'tradable' : 'view only'}`;
</script>

<svelte:head><title>Token · PennyPicker</title></svelte:head>

<main class="pp-container">
	<div class="pp-page-head">
		<div class="title">
			{#if market.id === 'pennypickerusd'}<img src="/pennypickerusd-256.png" alt="" width="56" height="56" />{/if}
			<div>
				<h1>{market.name} <span class="muted">({market.symbol})</span></h1>
				<p>{market.summary}</p>
			</div>
		</div>
		<span class="pp-badge {market.status === 'live' ? 'ok' : 'warn'}">{statusLabel(market)}</span>
	</div>

	<div class="pp-grid-2">
		<section class="pp-card">
			<h2>Token</h2>
			<dl class="pp-kv">
				<dt>Name</dt><dd>{market.name}</dd>
				<dt>Ticker</dt><dd>{market.symbol} <span class="muted small">(several tokens use this ticker: always check the category)</span></dd>
				<dt>Network</dt><dd>{market.network === 'chipnet' ? 'BCH Chipnet (test network)' : 'BCH mainnet'}</dd>
				{#if market.id === 'pennypickerusd'}
					<dt>Supply</dt><dd>1,000,000.00, fixed (no minting baton)</dd>
					<dt>Decimals</dt><dd>2 (1 PUSD = 100 base units)</dd>
					<dt>Price</dt><dd>Treated as 1 USD for trading; a test token with no backing or value</dd>
					<dt>Metadata</dt><dd>Published on-chain (BCMR), so Cashonize and other wallets show it as <strong>PennyPickerUSD</strong> with this icon. <a href="/.well-known/bitcoin-cash-metadata-registry.json" target="_blank" rel="noopener">Registry ↗</a></dd>
				{/if}
				<dt>Category</dt>
				<dd class="mono small">
					{#if market.category}<a href={explorer(market.network, market.category)} target="_blank" rel="noopener">{market.category}</a>{:else}—{/if}
				</dd>
			</dl>
			{#if market.links.length}
				<div class="pp-row" style="margin-top: 0.75rem">
					{#each market.links as link (link.href)}<a class="pp-btn pp-btn-sm" href={link.href} target="_blank" rel="noopener">{link.label} ↗</a>{/each}
				</div>
			{/if}
		</section>

		<section class="pp-card">
			<h2>Your balance</h2>
			{#if !pp.wallet}
				<p class="muted">Connect Cashonize ({NETWORKS[market.network].label}) to see your balances.</p>
				<a class="pp-btn pp-btn-primary" href="/wallet">Connect wallet</a>
			{:else}
				<div class="pp-grid-2">
					<div><div class="pp-stat-label">BCH</div><div class="pp-stat-value">{pp.utxosLoaded ? formatSats(pp.balances.bchSats) : "…"}</div></div>
					<div><div class="pp-stat-label">{market.symbol}</div><div class="pp-stat-value">{pp.utxosLoaded ? formatUnits(pp.balances.pusdUnits) : "…"}</div></div>
				</div>
				{#if market.network === 'chipnet'}
					<p class="small muted" style="margin-top: 0.6rem">Need test PUSD? Ask in the community chat, or sell test BCH into a bid on the <a href="/">Exchange</a>.</p>
				{:else}
					<p class="small muted" style="margin-top: 0.6rem">Read-only view of your mainnet wallet.{market.status === 'live' ? '' : ' Mainnet trading is not open yet.'}</p>
				{/if}
			{/if}
		</section>
	</div>

	<section class="pp-card" style="margin-top: 1rem">
		<h2>Markets</h2>
		<div class="markets">
			{#each MARKETS as m (m.id)}
				<button type="button" class="pp-card mkt" class:sel={m.id === market.id} onclick={() => pp.selectMarket(m.id)}>
					<strong>BCH / {m.name}</strong>
					<span class="small muted">{statusLabel(m)}</span>
				</button>
			{/each}
		</div>
		<p class="small muted" style="margin-top: 0.6rem">Both markets price orders against the same oracles.cash BCH/USD oracle. Mainnet orders are capped until the contracts are independently audited.</p>
	</section>
</main>

<style>
	.title { display: flex; gap: 1rem; align-items: center; }
	.title img { border-radius: 50%; box-shadow: var(--pp-shadow); flex: none; }
	.markets { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 0.6rem; }
	.mkt { text-align: left; display: flex; flex-direction: column; gap: 0.2rem; cursor: pointer; font: inherit; color: var(--pp-text); }
	.mkt.sel { border-color: var(--pp-accent); box-shadow: inset 3px 0 0 var(--pp-accent); }
</style>
