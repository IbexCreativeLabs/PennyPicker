<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import '$lib/pennypicker/ui/theme.css';
	import { pp } from '$lib/pennypicker/ui/session.svelte';
	import { formatPrice } from '$lib/pennypicker/contracts';

	let { children } = $props();
	let menuOpen = $state(false);

	const nav = [
		{ href: '/penny-picker/exchange', label: 'Exchange' },
		{ href: '/penny-picker/token', label: 'Token' },
		{ href: '/penny-picker/oracle', label: 'Oracle' },
		{ href: '/penny-picker/mechanisms', label: 'Mechanisms' },
		{ href: '/penny-picker/wallet', label: 'Wallet' }
	];
	const active = (href: string) => page.url.pathname === href || page.url.pathname.startsWith(href + '/');
	const doneCount = $derived(pp.setup.filter((s) => s.state === 'done').length);

	onMount(() => pp.start());
</script>

<div class="pp">
	<header class="topbar">
		<div class="bar">
			<a class="brand" href="/penny-picker">
				<span class="coin" aria-hidden="true">¢</span>
				<span><strong>PennyPicker</strong><small>BCH / PUSD</small></span>
			</a>
			<button class="menu pp-btn pp-btn-ghost" type="button" aria-label="Menu" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>☰</button>
			<nav class:open={menuOpen}>
				{#each nav as item (item.href)}
					<a href={item.href} class:active={active(item.href)} aria-current={active(item.href) ? 'page' : undefined} onclick={() => (menuOpen = false)}>{item.label}</a>
				{/each}
			</nav>
			<div class="status">
				<span class="pp-badge accent plain" title="All transactions use BCH Chipnet (test network)">Chipnet</span>
				{#if pp.price}
					<a href="/penny-picker/oracle" class="pp-badge {pp.oracleStale ? 'warn' : 'ok'}" title="Operator-published reference price">
						{formatPrice(pp.price)}
					</a>
				{:else if pp.market}
					<span class="pp-badge warn">No oracle</span>
				{:else}
					<span class="pp-badge warn">Market not set</span>
				{/if}
				{#if pp.walletStatus === 'connected' && pp.wallet}
					<a href="/penny-picker/wallet" class="pp-badge ok" title={pp.wallet.address}>{pp.wallet.address.slice(8, 14)}…{pp.wallet.address.slice(-4)}</a>
				{:else if pp.walletStatus === 'checking'}
					<span class="pp-badge">Wallet…</span>
				{:else}
					<a href="/penny-picker/wallet" class="pp-badge bad">Connect wallet</a>
				{/if}
			</div>
		</div>
		{#if doneCount < pp.setup.length && pp.nextStep}
			<div class="setup-strip">
				<div class="bar">
					<span class="muted small">Setup {doneCount}/{pp.setup.length}</span>
					<span class="progress"><span style="width: {(doneCount / pp.setup.length) * 100}%"></span></span>
					<span class="small">Next: <a href={pp.nextStep.href}>{pp.nextStep.label}</a> <span class="muted">— {pp.nextStep.detail}</span></span>
				</div>
			</div>
		{/if}
	</header>

	{@render children()}

	<footer class="foot">
		<div class="bar small muted">
			<span>Experimental prototype on BCH Chipnet. PUSD is a test token with no USD backing or peg.</span>
			<span><a href="/penny-picker">Overview</a> · <a href="/penny-picker/simulator">Simulator</a> · <a href="/">Vox</a></span>
		</div>
	</footer>
</div>

<style>
	.topbar { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 20; background: color-mix(in srgb, var(--pp-surface) 92%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--pp-border); }
	.bar { max-width: 76rem; margin: 0 auto; padding: 0.55rem max(16px, 2vw); display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
	.brand { display: flex; align-items: center; gap: 0.55rem; color: var(--pp-text) !important; text-decoration: none !important; }
	.brand strong { display: block; font-size: 1rem; line-height: 1.1; }
	.brand small { display: block; color: var(--pp-muted); font-size: 0.72rem; letter-spacing: 0.05em; }
	.coin { width: 2rem; height: 2rem; border-radius: 50%; display: grid; place-items: center; font-weight: 800; background: radial-gradient(circle at 35% 30%, #e7a36b, var(--pp-accent) 70%); color: #fff; box-shadow: inset 0 -2px 0 rgba(0,0,0,0.15); }
	nav { display: flex; gap: 0.15rem; flex: 1; }
	nav a { padding: 0.4rem 0.7rem; border-radius: 8px; color: var(--pp-muted); font-weight: 550; text-decoration: none !important; }
	nav a:hover { background: var(--pp-surface-2); color: var(--pp-text); }
	nav a.active { background: var(--pp-accent-soft); color: var(--pp-accent); }
	.status { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
	.status a { text-decoration: none !important; }
	.menu { display: none; margin-left: auto; font-size: 1.2rem; }
	.setup-strip { border-top: 1px solid var(--pp-border); background: var(--pp-surface-2); }
	.setup-strip .bar { padding-block: 0.35rem; gap: 0.75rem; }
	.progress { width: 7rem; height: 6px; border-radius: 3px; background: var(--pp-border); overflow: hidden; }
	.progress span { display: block; height: 100%; background: var(--pp-accent); }
	.foot { border-top: 1px solid var(--pp-border); }
	.foot .bar { justify-content: space-between; padding-block: 1rem; }
	@media (max-width: 860px) {
		.menu { display: inline-flex; }
		nav { display: none; flex-basis: 100%; flex-direction: column; order: 5; }
		nav.open { display: flex; }
		.status { flex-basis: 100%; }
	}
</style>
