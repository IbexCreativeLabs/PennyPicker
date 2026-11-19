<script lang="ts">
	import { COMMUNITY } from '$lib/pennypicker/deployment';
</script>

<svelte:head><title>Safety &amp; status · PennyPicker</title></svelte:head>

<header class="ab-head">
	<p class="kicker">Safety &amp; status</p>
	<h1>An experimental prototype</h1>
	<p class="lead">Built for a hackathon. Read this before using real money.</p>
</header>

<div class="ab-grid">
	<article class="pp-card ab-card">
		<span class="tag">Test network</span>
		<h3><span class="ab-icon">◎</span>PennyPickerUSD on Chipnet</h3>
		<p>A test token treated as 1 USD, with no backing and no value. Safe to experiment with.</p>
	</article>
	<article class="pp-card ab-card danger">
		<span class="tag">Real money</span>
		<h3><span class="ab-icon">$</span>ParyonUSD on mainnet</h3>
		<p>The real stablecoin. Orders are capped at <strong>25 PUSD</strong> each until the contracts are independently audited.</p>
	</article>
</div>

<section class="ab-section">
	<h2>Known risks and limits</h2>
	<div class="pp-card">
		<ul class="ab-list">
			<li data-i="⚠"><span><strong>No independent audit.</strong> The contracts have had an internal security review only.</span></li>
			<li data-i="⏱"><span><strong>No price keeper yet.</strong> The on-chain price only updates when someone trades or pushes it. An order left open in a quiet market can be filled at the last stored price, so keep mainnet orders small and short-lived.</span></li>
			<li data-i="⇆"><span><strong>Choice of recent prices.</strong> The chain cannot see the clock, so a taker can pick any oracle message published since the last on-chain update (usually minutes).</span></li>
			<li data-i="↻"><span><strong>One shared price record.</strong> Two trades at the same moment conflict; the second one is rebuilt and signed again.</span></li>
			<li data-i="∿"><span><strong>Simulations are labelled.</strong> Liquidations and redemptions are pricing designs, not deployed contracts.</span></li>
		</ul>
	</div>
</section>

<section class="ab-section">
	<h2>What protects you</h2>
	<div class="ab-grid">
		<div class="pp-card ab-card"><h3><span class="ab-icon">✎</span>Your keys stay in your wallet</h3><p>PennyPicker never sees them. Every transaction is signed in Cashonize.</p></div>
		<div class="pp-card ab-card"><h3><span class="ab-icon">⊘</span>Only you can cancel</h3><p>An order's remaining coins can only be withdrawn with the maker's key.</p></div>
		<div class="pp-card ab-card"><h3><span class="ab-icon">✓</span>Genuine prices only</h3><p>The contract rejects any price not signed by oracles.cash, and any older than the one stored.</p></div>
	</div>
</section>

<section class="ab-section">
	<h2>Open source &amp; credits</h2>
	<div class="pp-card">
		<p style="margin-top: 0">
			The full source, the security review and the transaction log are on
			<a href={COMMUNITY.sourceUrl} target="_blank" rel="noopener">GitHub</a>.
		</p>
		<p class="muted small" style="margin-bottom: 0">
			Forked from <a href={COMMUNITY.forkedFromUrl} target="_blank" rel="noopener">Vox</a> by 2qx. Built with CashScript, Libauth and
			Cashonize, priced by the General Protocols oracle behind oracles.cash.
		</p>
	</div>
</section>

<style>
	.danger { border-color: color-mix(in srgb, var(--pp-ask) 40%, var(--pp-border)); }
	.danger .ab-icon { background: var(--pp-ask-soft); color: var(--pp-ask); }
</style>
