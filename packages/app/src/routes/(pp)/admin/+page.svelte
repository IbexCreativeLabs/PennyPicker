<script lang="ts">
	import { pp, formatAge } from '$lib/pennypicker/ui/session.svelte';
	import { formatPrice } from '$lib/pennypicker/contracts';
	import { formatBchFromSatoshis, formatPusd } from '$lib/pennypicker/market';

	const openOrders = $derived(pp.discovery?.orders.filter((o) => !o.exhausted).length ?? 0);
	const icon = { done: '✓', pending: '○', blocked: '·' } as const;
</script>

<svelte:head><title>Admin · PennyPicker</title><meta name="robots" content="noindex" /></svelte:head>

<main class="pp-container">
	<div class="pp-page-head">
		<div>
			<h1>BCH / PUSD orderbook, priced in basis points</h1>
			<p>Orders on PennyPicker don't set a fixed price. Each one sets a BPS deviation from an on-chain reference price, and covenants settle every fill against the latest reference.</p>
		</div>
		<a class="pp-btn pp-btn-primary" href="/">Open exchange →</a>
	</div>

	<div class="pp-grid-3">
		<div class="pp-card">
			<div class="pp-stat-label">Reference price</div>
			<div class="pp-stat-value">{pp.price ? formatPrice(pp.price) : '—'} <small>PUSD/BCH</small></div>
			<div class="small">
				{#if pp.oracle}
					<span class="pp-badge {pp.oracleStale ? 'warn' : 'ok'}">{pp.oracleStale ? 'Stale' : 'Fresh'} · {formatAge(pp.oracleAge)}</span>
				{:else}
					<span class="muted">{pp.loadingMarket ? 'Loading…' : 'No oracle yet'}</span>
				{/if}
			</div>
		</div>
		<div class="pp-card">
			<div class="pp-stat-label">Open orders</div>
			<div class="pp-stat-value">{pp.discovery ? openOrders : '—'}</div>
			<div class="small muted">{pp.discovery ? `${pp.discovery.fills.length} fills · ${pp.discovery.canceled.length} cancels observed` : 'Available once the oracle exists'}</div>
		</div>
		<div class="pp-card">
			<div class="pp-stat-label">Your wallet</div>
			{#if pp.wallet}
				<div class="pp-stat-value">{formatBchFromSatoshis(pp.balances.bchSats)} <small>BCH</small></div>
				<div class="small muted">{formatPusd(pp.balances.pusdUnits)} PUSD</div>
			{:else}
				<div class="pp-stat-value">—</div>
				<div class="small"><a href="/wallet">Connect Cashonize</a></div>
			{/if}
		</div>
	</div>

	<div class="pp-grid-2" style="margin-top: 1rem">
		<section class="pp-card">
			<div class="pp-card-head">
				<h2>Chipnet setup &amp; test progress</h2>
				<button class="pp-btn pp-btn-sm" type="button" onclick={() => pp.refreshAll()} disabled={pp.loadingMarket || pp.loadingWallet}>
					{pp.loadingMarket || pp.loadingWallet ? 'Checking…' : 'Re-check'}
				</button>
			</div>
			<p class="small muted">Each step is checked against Chipnet data (Electrum), not page visits or clicks.</p>
			<ol class="steps">
				{#each pp.setup as step (step.id)}
					<li class={step.state}>
						<span class="dot" aria-hidden="true">{icon[step.state]}</span>
						<span class="label">{step.label}</span>
						<span class="detail small">{step.detail}</span>
						{#if step.state === 'pending'}<a class="small" href={step.href}>Go →</a>{/if}
					</li>
				{/each}
			</ol>
		</section>

		<section class="pp-card">
			<h2>How pricing works</h2>
			<dl class="pp-kv">
				<dt>Reference</dt><dd>Live BCH/USD price signed by oracles.cash, verified on-chain (1 PUSD treated as 1 USD)</dd>
				<dt>BPS</dt><dd>1 BPS = 0.01%. 100 BPS = 1%</dd>
				<dt>Limit price</dt><dd><span class="mono">reference × (10000 + BPS) / 10000</span></dd>
				<dt>Ask (sell BCH)</dt><dd>BPS ≥ 0, at or above the reference. Escrows BCH</dd>
				<dt>Bid (buy BCH)</dt><dd>BPS ≤ 0, at or below the reference. Escrows PUSD</dd>
			</dl>
			<p class="pp-callout small" style="margin-top: 0.75rem">
				Example: with a reference of 500.00 PUSD/BCH, an ask at +50 BPS has a limit of <strong>502.50 PUSD/BCH</strong>. If BCH moves to 520.00, the same order re-prices to 522.60 without being edited.
			</p>
			<p class="small muted" style="margin-top: 0.5rem">The reference comes from the oracles.cash BCH/USD oracle (General Protocols); the contract checks its signature. See <a href="/oracle">Oracle</a>.</p>
		</section>
	</div>

	{#if pp.config.pusdCategory || pp.config.oracleCategory}
		<details class="pp-details" style="margin-top: 1rem">
			<summary>Market identifiers</summary>
			<dl class="pp-kv">
				<dt>PUSD category</dt><dd class="mono">{pp.config.pusdCategory ?? '—'} <span class="faint">({pp.config.source.pusdCategory})</span></dd>
				<dt>Oracle category</dt><dd class="mono">{pp.config.oracleCategory ?? '—'} <span class="faint">({pp.config.source.oracleCategory})</span></dd>
				<dt>Operator PKH</dt><dd class="mono">{pp.config.oracleOperatorPkh ?? '—'} <span class="faint">({pp.config.source.oracleOperatorPkh})</span></dd>
			</dl>
		</details>
	{/if}
	{#if pp.marketError}<p class="pp-error">{pp.marketError}</p>{/if}
</main>

<style>
	.steps { list-style: none; padding: 0; margin: 0.5rem 0 0; }
	.steps li { display: grid; grid-template-columns: 1.5rem 1fr auto; grid-template-areas: 'dot label go' 'dot detail go'; column-gap: 0.5rem; padding: 0.45rem 0; border-bottom: 1px solid var(--pp-border); }
	.steps li:last-child { border-bottom: 0; }
	.dot { grid-area: dot; width: 1.3rem; height: 1.3rem; border-radius: 50%; display: grid; place-items: center; font-size: 0.75rem; font-weight: 700; background: var(--pp-surface-2); color: var(--pp-faint); border: 1px solid var(--pp-border); margin-top: 0.1rem; }
	.label { grid-area: label; font-weight: 550; }
	.detail { grid-area: detail; color: var(--pp-muted); }
	.steps li a { grid-area: go; align-self: center; }
	li.done .dot { background: var(--pp-bid); color: #fff; border-color: transparent; }
	li.pending .dot { color: var(--pp-accent); border-color: var(--pp-accent); }
	li.blocked .label { color: var(--pp-faint); }
</style>
