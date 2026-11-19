<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import '$lib/pennypicker/ui/theme.css';
	import { pp } from '$lib/pennypicker/ui/session.svelte';
	import { formatPrice } from '$lib/pennypicker/contracts';
	import DemoNotice from '$lib/pennypicker/ui/DemoNotice.svelte';
	import TelegramChat from '$lib/pennypicker/ui/TelegramChat.svelte';
	import { MARKETS, COMMUNITY } from '$lib/pennypicker/deployment';
	import { NETWORKS } from '$lib/pennypicker/network';

	const shortAddress = (address: string) => {
		const body = address.split(':')[1] ?? address;
		return `${body.slice(0, 6)}…${body.slice(-4)}`;
	};

	const build = __PENNYPICKER_BUILD__;
	let notice: DemoNotice | undefined = $state();

	let { children } = $props();
	let menuOpen = $state(false);

	const nav = [
		{ href: '/', label: 'Exchange' },
		{ href: '/wallet', label: 'Wallet' },
		{ href: '/about', label: 'About' }
	];
	const active = (href: string) => (href === '/' ? page.url.pathname === '/' : page.url.pathname === href || page.url.pathname.startsWith(href + '/'));
	let marketOpen = $state(false);

	onMount(() => pp.start());
</script>

<svelte:head><link rel="icon" href="/pennypicker.svg" type="image/svg+xml" /></svelte:head>

<div class="pp">
	<header class="topbar">
		<div class="bar">
			<a class="brand" href="/">
				<span class="coin" aria-hidden="true">¢</span>
				<strong>PennyPicker</strong>
			</a>
			<div class="market">
				<button class="market-btn" type="button" aria-haspopup="listbox" aria-expanded={marketOpen} onclick={() => (marketOpen = !marketOpen)}>
					<span class="pair">BCH / {pp.selectedMarket.name}</span>
					<span class="net {pp.selectedMarket.network}">{pp.networkInfo.label}</span>
					<span aria-hidden="true">▾</span>
				</button>
				{#if marketOpen}
					<ul class="market-list pp-card" role="listbox" aria-label="Stablecoin">
						{#each MARKETS as m (m.id)}
							<li>
								<button type="button" role="option" aria-selected={m.id === pp.selectedMarketId} class:sel={m.id === pp.selectedMarketId} onclick={() => { pp.selectMarket(m.id); marketOpen = false; }}>
									<span><strong>{m.name}</strong> <span class="muted small">{m.symbol}</span></span>
									<span class="small muted">{NETWORKS[m.network].label} · {m.status === 'live' ? 'tradable' : 'view only'}{NETWORKS[m.network].realFunds ? ' · real money' : ' · test coins'}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
			<button class="menu pp-btn pp-btn-ghost" type="button" aria-label="Menu" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>☰</button>
			<nav class:open={menuOpen}>
				{#each nav as item (item.href)}
					<a href={item.href} class:active={active(item.href)} aria-current={active(item.href) ? 'page' : undefined} onclick={() => (menuOpen = false)}>{item.label}</a>
				{/each}
			</nav>
			<div class="status">
				{#if pp.marketError}<span class="pp-badge bad plain" title={pp.marketError}>{pp.networkInfo.label} offline</span>{/if}
				<button class="pp-badge warn plain demo" type="button" onclick={() => notice?.show()} title="About this experimental demo">Demo</button>
				{#if pp.displayPrice}
					<a href="/about/oracle" class="pp-badge {pp.price && pp.oracleStale ? 'warn' : 'ok'}" title="Reference price: oracles.cash BCH/USD">
						{formatPrice(pp.displayPrice)}
					</a>
				{:else if pp.market && !pp.oracleLoaded}
					<span class="pp-badge plain">Loading…</span>
				{:else if pp.market}
					<span class="pp-badge warn">No oracle</span>
				{:else}
					<span class="pp-badge warn">Market not set</span>
				{/if}
				{#if pp.walletStatus === 'connected' && pp.wallet}
					<a href="/wallet" class="pp-badge ok" title={pp.wallet.address}>{shortAddress(pp.wallet.address)}</a>
				{:else if pp.walletStatus === 'checking'}
					<span class="pp-badge">Wallet…</span>
				{:else}
					<a href="/wallet" class="pp-badge bad">Connect wallet</a>
				{/if}
			</div>
		</div>
		{#if pp.marketError}
			<div class="net-strip" role="alert">
				<div class="bar small">
					<span><strong>{pp.networkInfo.label} connection problem.</strong> {pp.marketError}</span>
					<button class="pp-btn pp-btn-sm" type="button" onclick={() => pp.refreshAll()} disabled={pp.loadingMarket}>{pp.loadingMarket ? 'Retrying…' : 'Retry'}</button>
				</div>
			</div>
		{/if}
	</header>

	{@render children()}

	<DemoNotice bind:this={notice} />
	<TelegramChat />

	<footer class="foot">
		<div class="bar small muted">
			<span>{#if pp.networkInfo.realFunds}Experimental prototype. {pp.selectedMarket.name} on BCH mainnet is real money; the contracts are not independently audited and orders are capped.{:else}Experimental prototype on BCH Chipnet. PUSD is a test token priced as 1 USD, with no real backing.{/if} Prices come from the oracles.cash BCH/USD oracle. <button class="linkish" type="button" onclick={() => notice?.show()}>About this demo</button> · build {build.commit}</span>
			<span><a href="/about">About</a> · <a href={COMMUNITY.sourceUrl} target="_blank" rel="noopener">Source code</a></span>
		</div>
	</footer>
</div>

<style>
	.topbar { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 20; background: color-mix(in srgb, var(--pp-surface) 92%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--pp-border); }
	.bar { max-width: 76rem; margin: 0 auto; padding: 0.55rem max(16px, 2vw); display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
	.brand { display: flex; align-items: center; gap: 0.55rem; color: var(--pp-text) !important; text-decoration: none !important; }
	.brand strong { display: block; font-size: 1rem; line-height: 1.1; }
	.coin { width: 2rem; height: 2rem; border-radius: 50%; display: grid; place-items: center; font-weight: 800; background: radial-gradient(circle at 35% 30%, #e7a36b, var(--pp-accent) 70%); color: #fff; box-shadow: inset 0 -2px 0 rgba(0,0,0,0.15); }
	nav { display: flex; gap: 0.15rem; flex: 1; }
	nav a { padding: 0.4rem 0.7rem; border-radius: 8px; color: var(--pp-muted); font-weight: 550; text-decoration: none !important; }
	nav a:hover { background: var(--pp-surface-2); color: var(--pp-text); }
	nav a.active { background: var(--pp-accent-soft); color: var(--pp-accent); }
	.net-strip { background: var(--pp-danger); color: #fff; }
	.net-strip .bar { justify-content: space-between; padding-block: 0.35rem; }
	.status { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
	.status a { text-decoration: none !important; }
	.bar .menu { display: none; margin-left: auto; font-size: 1.2rem; }
	.market { position: relative; }
	.market-btn { display: inline-flex; align-items: center; gap: 0.45rem; border: 1px solid var(--pp-border); background: var(--pp-surface); color: var(--pp-text); border-radius: 999px; padding: 0.3rem 0.7rem; font: inherit; font-size: 0.85rem; font-weight: 600; cursor: pointer; }
	.market-btn:hover { border-color: var(--pp-border-strong); }
	.net { font-size: 0.7rem; padding: 0.05rem 0.4rem; border-radius: 999px; }
	.net.chipnet { background: var(--pp-accent-soft); color: var(--pp-accent); }
	.net.mainnet { background: var(--pp-info-soft); color: #2f5b9a; }
	.market-list { position: absolute; top: calc(100% + 6px); left: 0; z-index: 30; list-style: none; margin: 0; padding: 0.3rem; min-width: 16rem; }
	.market-list button { display: flex; flex-direction: column; align-items: flex-start; gap: 0.1rem; width: 100%; text-align: left; border: 0; background: none; color: var(--pp-text); font: inherit; padding: 0.5rem 0.6rem; border-radius: 8px; cursor: pointer; }
	.market-list button:hover, .market-list button.sel { background: var(--pp-surface-2); }
	.market-list button.sel { box-shadow: inset 3px 0 0 var(--pp-accent); }
	.foot { border-top: 1px solid var(--pp-border); padding-bottom: 3.5rem; }
	.demo { cursor: pointer; font: inherit; font-size: 0.78rem; font-weight: 600; }
	.linkish { border: 0; background: none; padding: 0; color: var(--pp-accent); font: inherit; cursor: pointer; text-decoration: underline; }
	.foot .bar { justify-content: space-between; padding-block: 1rem; }
	@media (max-width: 860px) {
		.bar .menu { display: inline-flex; }
		nav { display: none; flex-basis: 100%; flex-direction: column; order: 5; }
		nav.open { display: flex; }
		.status { flex-basis: 100%; }
	}
	@media (max-width: 560px) {
		/* Keep the coin, market selector and menu on one row on phones. */
		.bar { gap: 0.5rem; }
		.brand strong { display: none; }
	}
</style>
