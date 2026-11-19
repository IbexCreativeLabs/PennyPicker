<svelte:head>
	<title>About · PennyPicker</title>
	<meta name="description" content="PennyPicker: an oracle-delta basis-points orderbook DEX for stablecoins on Bitcoin Cash." />
</svelte:head>

<header class="ab-head">
	<p class="kicker">Overview</p>
	<h1>Limit orders that never go stale</h1>
	<p class="lead">
		PennyPicker is an orderbook for trading BCH against USD stablecoins on Bitcoin Cash. Orders are priced in
		<strong>basis points (BPS) relative to the live oracle price</strong>, not at a fixed dollar price.
	</p>
</header>

<section class="pp-card example">
	<div class="ex-row">
		<div>
			<span class="tag">A normal orderbook</span>
			<p>"Sell 1 BCH at <strong>$500.00</strong>"</p>
			<small class="muted">BCH moves to $520 → your order is now $20 too cheap. You must cancel and re-quote.</small>
		</div>
		<span class="arrow" aria-hidden="true">→</span>
		<div>
			<span class="tag accent">PennyPicker</span>
			<p>"Sell 1 BCH at <strong>+25 BPS</strong>"</p>
			<small class="muted">Always 0.25% above the oracle price. BCH moves to $520 → your limit is $521.30, automatically.</small>
		</div>
	</div>
	<p class="ab-formula">limit price = oracle price × (10,000 + BPS) ÷ 10,000</p>
</section>

<section class="ab-section">
	<h2>One market, three stablecoin mechanics</h2>
	<p class="muted intro">Every core mechanism of a stablecoin protocol is a spread trade against the oracle. One oracle-delta market could replace three separate mechanics.</p>
	<div class="ab-grid">
		<article class="pp-card ab-card">
			<h3><span class="ab-icon">1</span>Swaps, not loans</h3>
			<div class="ab-compare">
				<div class="old"><b>Today</b>Open a "0% interest" loan to get stablecoins, hoping to be redeemed as an exit.</div>
				<div class="new"><b>PennyPicker</b>Swap BCH directly against resting bids near the oracle price (0 BPS).</div>
			</div>
		</article>
		<article class="pp-card ab-card">
			<h3><span class="ab-icon">2</span>P2P liquidations</h3>
			<div class="ab-compare">
				<div class="old"><b>Today</b>A flat 10% penalty paid into a Stability Pool.</div>
				<div class="new"><b>PennyPicker</b>Bids from 0 to −1000 BPS compete, so the discount falls toward fair value.</div>
			</div>
		</article>
		<article class="pp-card ab-card">
			<h3><span class="ab-icon">3</span>Market redemptions</h3>
			<div class="ab-compare">
				<div class="old"><b>Today</b>Hard-coded minimum fees and baseRate decay math.</div>
				<div class="new"><b>PennyPicker</b>Redeemable loans sit on the book, so the market sets the price.</div>
			</div>
		</article>
	</div>
</section>

<section class="ab-section">
	<h2>What is live today</h2>
	<div class="ab-grid">
		<a class="pp-card ab-card link" href="/">
			<h3><span class="ab-icon">⇄</span>Working exchange</h3>
			<p>Limit orders, instant trades and cancels, each a real Bitcoin Cash contract.</p>
		</a>
		<a class="pp-card ab-card link" href="/about/oracle">
			<h3><span class="ab-icon">◷</span>Real signed price</h3>
			<p>The oracles.cash BCH/USD price, verified on-chain by the contract.</p>
		</a>
		<a class="pp-card ab-card link" href="/about/token">
			<h3><span class="ab-icon">◎</span>Two markets</h3>
			<p>Test PUSD on Chipnet (free), and the real ParyonUSD on mainnet (capped).</p>
		</a>
	</div>
</section>

<style>
	.example { display: flex; flex-direction: column; gap: 0.4rem; }
	.ex-row { display: grid; grid-template-columns: 1fr auto 1fr; gap: 1rem; align-items: center; }
	.ex-row p { margin: 0.2rem 0; font-size: 1.05rem; }
	.ex-row small { display: block; line-height: 1.45; }
	.arrow { font-size: 1.4rem; color: var(--pp-accent); }
	.tag { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--pp-muted); }
	.tag.accent { color: var(--pp-accent); }
	.intro { margin: -0.3rem 0 0.9rem; max-width: 46rem; }
	.link { text-decoration: none !important; color: var(--pp-text); transition: border-color 0.15s, transform 0.15s; }
	.link:hover { border-color: var(--pp-accent); transform: translateY(-1px); }
	@media (max-width: 640px) {
		.ex-row { grid-template-columns: 1fr; }
		.arrow { transform: rotate(90deg); justify-self: center; }
	}
</style>
