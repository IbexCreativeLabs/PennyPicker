<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import '$lib/pennypicker/ui/theme.css';
	import { pp } from '$lib/pennypicker/ui/session.svelte';
	import { formatPrice } from '$lib/pennypicker/contracts';
	import { formatUnits } from '$lib/pennypicker/exchange';
	import DemoNotice from '$lib/pennypicker/ui/DemoNotice.svelte';
	import TelegramChat from '$lib/pennypicker/ui/TelegramChat.svelte';
	import { MARKETS, COMMUNITY } from '$lib/pennypicker/deployment';
	import { NETWORKS } from '$lib/pennypicker/network';

	/** Compact BCH amount for the header (exact value in the tooltip). */
	const shortBch = (sats: bigint) => {
		const whole = Number(sats) / 1e8;
		return whole === 0 ? '0' : whole < 0.0001 ? '<0.0001' : whole.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
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

<div class="pp">
	<header class="topbar">
		<div class="bar">
			<a class="brand" href="/">
				<img class="logo" src="/pennypicker-128.png" alt="" width="36" height="36" />
				<strong>PennyPicker</strong>
			</a>
			<div class="market">
				<button class="market-btn" type="button" aria-haspopup="listbox" aria-expanded={marketOpen} onclick={() => (marketOpen = !marketOpen)}>
					<span class="pair">BCH / <span class="long">{pp.selectedMarket.name}</span><span class="short">{pp.selectedMarket.symbol}</span></span>
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
					<a href="/wallet" class="wallet-pill" title="{pp.wallet.kind === 'wizardconnect' ? `${pp.wallet.signer.walletName} (all addresses)` : pp.wallet.address} · {pp.networkInfo.label}">
						<span class="w-dot" aria-hidden="true"></span>
						{#if pp.utxosLoaded}
							<span class="w-bal num"><strong>{shortBch(pp.balances.bchSats)}</strong> BCH <span class="faint">·</span> <strong>{formatUnits(pp.balances.pusdUnits)}</strong> {pp.selectedMarket.symbol}</span>
						{:else}
							<span class="w-bal muted">Loading balance…</span>
						{/if}
					</a>
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
			<span>{#if pp.networkInfo.realFunds}Experimental prototype. {pp.selectedMarket.name} on BCH mainnet is real money; the contracts are not independently audited and orders are capped.{:else}Experimental prototype on BCH Chipnet. {pp.selectedMarket.symbol} is a test token priced as 1 USD, with no real backing.{/if} Prices come from the oracles.cash BCH/USD oracle. <button class="linkish" type="button" onclick={() => notice?.show()}>About this demo</button> · build {build.commit}</span>
			<span><a href="/about">About</a> · <a href={COMMUNITY.stakingArenaUrl} target="_blank" rel="noopener">Staking Arena ↗</a> · <a href={COMMUNITY.sourceUrl} target="_blank" rel="noopener">Source code</a></span>
		</div>
	</footer>
</div>

<style>
	.topbar { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 20; background: color-mix(in srgb, var(--pp-bg) 88%, transparent); backdrop-filter: blur(12px) saturate(1.4); box-shadow: 0 1px 0 var(--pp-border); }
	.bar { max-width: 76rem; margin: 0 auto; padding: 0.55rem max(16px, 2vw); display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
	.brand { display: flex; align-items: center; gap: 0.55rem; color: var(--pp-text) !important; text-decoration: none !important; }
	.brand strong { display: block; font-size: 1.05rem; line-height: 1.1; font-weight: 700; }
	.logo { width: 36px; height: 36px; flex: none; transition: transform 0.35s var(--pp-ease); }
	.brand:hover .logo { transform: rotate(-6deg) scale(1.06); }
	nav { display: flex; gap: 0.15rem; flex: 1; }
	nav a { padding: 0.4rem 0.75rem; border-radius: 8px; color: var(--pp-muted); font-weight: 550; text-decoration: none !important; transition: background 0.18s var(--pp-ease), color 0.18s var(--pp-ease); }
	nav a:hover { background: var(--pp-surface-2); color: var(--pp-text); }
	nav a.active { background: var(--pp-accent-soft); color: var(--pp-text); }
	.net-strip { background: var(--pp-danger); color: #fff; }
	.net-strip .bar { justify-content: space-between; padding-block: 0.35rem; }
	.status { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
	.status a { text-decoration: none !important; }
	.wallet-pill { display: inline-flex; align-items: center; gap: 0.45rem; background: var(--pp-surface-2); color: var(--pp-text) !important; border-radius: 999px; padding: 0.25rem 0.7rem; font-size: 0.8rem; transition: background 0.18s var(--pp-ease); }
	.wallet-pill:hover { background: var(--pp-accent-soft); }
	.w-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--pp-bid); box-shadow: 0 0 0 3px var(--pp-bid-soft); flex: none; }
	.w-bal strong { font-weight: 650; }
	.bar .menu { display: none; margin-left: auto; font-size: 1.2rem; }
	.market { position: relative; }
	.market-btn .short { display: none; }
	.market-btn { display: inline-flex; align-items: center; gap: 0.45rem; border: 0; background: var(--pp-surface-2); color: var(--pp-text); border-radius: 999px; padding: 0.32rem 0.75rem; font: inherit; font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: background 0.18s var(--pp-ease), transform 0.12s var(--pp-ease); }
	.market-btn:hover { background: var(--pp-accent-soft); }
	.market-btn:active { transform: scale(0.97); }
	.net { font-size: 0.7rem; padding: 0.05rem 0.4rem; border-radius: 999px; }
	.net.chipnet { background: var(--pp-accent-soft); color: var(--pp-accent); }
	.net.mainnet { background: var(--pp-ask-soft); color: var(--pp-ask); }
	.market-list { position: absolute; top: calc(100% + 6px); left: 0; z-index: 30; list-style: none; margin: 0; padding: 0.3rem; min-width: 16rem; box-shadow: var(--pp-shadow-lg); transform-origin: top left; animation: grow 0.2s var(--pp-ease); }
	@keyframes grow { from { opacity: 0; transform: scale(0.92) translateY(-4px); } }
	@media (prefers-reduced-motion: reduce) { .market-list { animation: none; } }
	.market-list button { display: flex; flex-direction: column; align-items: flex-start; gap: 0.1rem; width: 100%; text-align: left; border: 0; background: none; color: var(--pp-text); font: inherit; padding: 0.5rem 0.6rem; border-radius: 8px; cursor: pointer; }
	.market-list button:hover, .market-list button.sel { background: var(--pp-surface-2); }
	.market-list button.sel { box-shadow: inset 3px 0 0 var(--pp-brand); }
	.foot { box-shadow: 0 -1px 0 var(--pp-border); padding-bottom: 3.5rem; margin-top: 2rem; }
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
		.logo { width: 32px; height: 32px; }
		.market-btn { padding: 0.3rem 0.6rem; gap: 0.35rem; }
		.market-btn .long { display: none; }
		.market-btn .short { display: inline; }
	}
</style>
