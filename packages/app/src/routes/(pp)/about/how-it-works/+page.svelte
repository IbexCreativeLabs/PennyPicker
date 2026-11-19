<script lang="ts">
	import LiveExample from '$lib/pennypicker/ui/LiveExample.svelte';
	import { GP_BCH_USD_ORACLE } from '$lib/pennypicker/contracts';
</script>

<svelte:head><title>How it works · PennyPicker</title></svelte:head>

<header class="ab-head">
	<p class="kicker">How it works</p>
	<h1>Every order is its own contract</h1>
	<p class="lead">No server holds your coins. Orders, prices and settlement are enforced by Bitcoin Cash contracts, and your wallet signs every step.</p>
</header>

<section class="ab-section" style="margin-top: 0">
	<h2>The life of a trade</h2>
	<ol class="ab-steps">
		<li><strong>A maker places an order</strong><p>Their coins move into a new contract: asks hold BCH, bids hold the stablecoin. The order's terms (side, BPS, owner) are written into the contract itself.</p></li>
		<li><strong>The price comes from the oracle</strong><p>The contract reads the latest BCH/USD price stored on-chain. Its limit is always the oracle price ± its BPS.</p></li>
		<li><strong>A taker fills it</strong><p>The taker's transaction brings the newest signed price and pays exactly what the contract demands. The contract checks the maths with whole numbers, so there is no rounding loophole.</p></li>
		<li><strong>Or the maker cancels</strong><p>Only the maker's key can withdraw what is left of the order.</p></li>
	</ol>
</section>

<section class="ab-section">
	<h2>The building blocks</h2>
	<div class="ab-grid">
		<article class="pp-card ab-card">
			<span class="tag">Contract</span>
			<h3><span class="ab-icon">▣</span>Order covenant</h3>
			<p>One contract per order, holding its escrow. Partial fills keep the rest in a new copy of the same order.</p>
		</article>
		<article class="pp-card ab-card">
			<span class="tag">Contract</span>
			<h3><span class="ab-icon">◷</span>Oracle record</h3>
			<p>Stores the latest price signed by oracles.cash (key <span class="mono small">{GP_BCH_USD_ORACLE.publicKey.slice(0, 10)}…</span>). Anyone can update it, but only with a newer genuine message.</p>
		</article>
		<article class="pp-card ab-card">
			<span class="tag">Rule</span>
			<h3><span class="ab-icon">=</span>Exact settlement</h3>
			<p>Fills are checked with exact integer maths. Amounts are rounded to 0.01 PUSD in the maker's favour.</p>
		</article>
		<article class="pp-card ab-card">
			<span class="tag">Wallet</span>
			<h3><span class="ab-icon">✎</span>You sign everything</h3>
			<p>Cashonize over WalletConnect. Keys never leave the wallet. The app shows each transaction, checks the signed copy matches, and sends it only when you press Broadcast.</p>
		</article>
	</div>
</section>

<section class="ab-section">
	<h2>A worked example, with today's price</h2>
	<div class="pp-card">
		<LiveExample />
	</div>
</section>
