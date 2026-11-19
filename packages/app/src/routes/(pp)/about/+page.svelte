<script lang="ts">
	import { COMMUNITY } from '$lib/pennypicker/deployment';
</script>

<svelte:head>
	<title>How it works · PennyPicker</title>
	<meta name="description" content="PennyPicker: an order book for BCH and USD stablecoins where every price is set in basis points from the live oracle." />
</svelte:head>

<header class="ab-head">
	<h1>How PennyPicker works</h1>
	<p class="lead">
		An order book for BCH and USD stablecoins on Bitcoin Cash. You set your price in basis points from the live
		oracle price, and every order is its own contract.
	</p>
</header>

<section class="pp-card compare">
	<div class="side">
		<span class="label">A normal order book</span>
		<p class="quote">“Sell 1 BCH at <strong>$500.00</strong>”</p>
		<p class="muted small">BCH moves to $520. Your order is now $20 too cheap and someone takes it.</p>
	</div>
	<span class="arrow" aria-hidden="true">→</span>
	<div class="side">
		<span class="label accent">PennyPicker</span>
		<p class="quote">“Sell 1 BCH at <strong>+25 BPS</strong>”</p>
		<p class="muted small">Always 0.25% above the oracle. BCH moves to $520, your price is $521.30 without you doing anything.</p>
	</div>
	<p class="formula num">limit price = oracle price × (1 + BPS ÷ 10,000)</p>
</section>

<section class="ab-section">
	<h2>The life of a trade</h2>
	<ol class="ab-steps">
		<li><strong>A maker places an order</strong><p>Their coins move into a new contract with the order's side and BPS written into it.</p></li>
		<li><strong>A taker fills it</strong><p>The taker's transaction brings the newest signed oracle price, and the contract checks they pay exactly what the order asks.</p></li>
		<li><strong>Or the maker cancels</strong><p>Only the maker's key can take back what is left.</p></li>
	</ol>
</section>

<section class="ab-section">
	<h2>Try it in five minutes</h2>
	<p class="muted small intro">On BCH Chipnet, a test network: the coins are free and worth nothing.</p>
	<ol class="ab-steps">
		<li><strong>Get a wallet</strong><p><a href="https://cashonize.com" target="_blank" rel="noopener">Cashonize</a>, switched to Chipnet in Settings.</p></li>
		<li><strong>Get test BCH</strong><p>From the <a href="https://tbch.googol.cash" target="_blank" rel="noopener">Chipnet faucet</a>.</p></li>
		<li><strong>Connect</strong><p>On <a href="/wallet">Wallet</a>: WalletConnect, or WizardConnect for HD wallets.</p></li>
		<li><strong>Trade</strong><p>Sell 0.001 BCH into a bid to get PPUSD, then place your own order at, say, +25 BPS.</p></li>
	</ol>
	<p class="cta"><a class="pp-btn pp-btn-primary" href="/">Open the Exchange</a></p>
</section>

<section class="ab-section">
	<h2>Why it matters for stablecoins</h2>
	<ul class="why">
		<li><strong>Swaps instead of loans.</strong> Trade BCH for stablecoins near 0 BPS instead of opening a “0% loan”.</li>
		<li><strong>Fairer liquidations.</strong> Bids from 0 to −1000 BPS compete, instead of a flat 10% penalty.</li>
		<li><strong>Market-priced redemptions.</strong> The book sets the price, not hard-coded fees.</li>
	</ul>
	<a class="companion" href={COMMUNITY.stakingArenaUrl} target="_blank" rel="noopener">
		PennyPicker is one half of a larger stablecoin design. The other half is <strong>Staking Arena</strong> ↗
	</a>
</section>

<style>
	.compare { display: grid; grid-template-columns: 1fr auto 1fr; gap: 0.5rem 1.5rem; align-items: start; }
	.side { min-width: 0; }
	.label { font-size: 0.85rem; font-weight: 600; color: var(--pp-muted); }
	.label.accent { color: var(--pp-accent); }
	.quote { font-size: 1.15rem; margin: 0.25rem 0; }
	.arrow { font-size: 1.5rem; color: var(--pp-faint); align-self: center; }
	.formula { grid-column: 1 / -1; margin: 0.6rem 0 0; padding-top: 0.75rem; box-shadow: 0 -1px 0 var(--pp-border); text-align: center; font-weight: 600; }
	.intro { margin: -0.4rem 0 1rem; }
	.cta { margin-top: 1.25rem; }
	.why { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.5rem; max-width: 40rem; }
	.companion { display: inline-block; margin-top: 1.25rem; padding: 0.75rem 1rem; border-radius: var(--pp-radius-sm); background: var(--pp-accent-soft); color: var(--pp-text) !important; text-decoration: none !important; transition: transform 0.15s var(--pp-ease); }
	.companion:hover { transform: translateY(-1px); }
	@media (max-width: 640px) {
		.compare { grid-template-columns: 1fr; }
		.arrow { transform: rotate(90deg); justify-self: start; }
	}
</style>
