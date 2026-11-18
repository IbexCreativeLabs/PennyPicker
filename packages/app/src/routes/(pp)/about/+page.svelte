<script lang="ts">
	import Mechanisms from '$lib/pennypicker/ui/Mechanisms.svelte';
	import { COMMUNITY } from '$lib/pennypicker/deployment';
	import { GP_BCH_USD_ORACLE } from '$lib/pennypicker/contracts';
</script>

<svelte:head>
	<title>About · PennyPicker</title>
	<meta name="description" content="PennyPicker: an oracle-delta basis-points orderbook DEX for stablecoins on Bitcoin Cash." />
</svelte:head>

<main class="pp-container">
	<section class="hero">
		<p class="eyebrow">About</p>
		<h1>PennyPicker</h1>
		<p class="tagline">Oracle Delta Basis Points Denominated Orderbook DEX for Stablecoins</p>
		<p class="lead">
			Instead of pricing limit orders at a static dollar price that goes stale every time BCH moves, orders are denominated in
			basis points (±bps) relative to the live oracle price.
		</p>
		<p>
			Because every core mechanism in a stablecoin protocol is ultimately a spread trade against the oracle, an oracle-delta
			orderbook doesn't just improve stablecoin trading experience and liquidity — it could also replace three separate protocol
			mechanics with a single P2P market:
		</p>
	</section>

	<ol class="pillars">
		<li class="pp-card">
			<h2>No more "0% interest PUSD loans" just to swap BCH to PUSD</h2>
			<p>
				Instead of opening a 0% loan hoping to get redeemed against as a zero-slippage exit, users can swap BCH for PUSD directly
				against resting bids anchored tightly around the oracle price (0 bps).
			</p>
		</li>
		<li class="pp-card">
			<h2>P2P market liquidations (0–10%) instead of a flat 10% penalty</h2>
			<p>
				Replace the Stability Pool with P2P bids ranging from 0 bps to −1000 bps (0–10% discount). Market competition drives
				liquidation penalties down in normal conditions, saving borrowers from a flat 10% haircut.
			</p>
		</li>
		<li class="pp-card">
			<h2>Market-based redemptions</h2>
			<p>
				Eliminate hardcoded minimum redemption fees and engineered baseRate decay math. Redemption-eligible loans sit directly on
				the orderbook, making redemption pricing 100% market-driven.
			</p>
		</li>
	</ol>

	<section class="pp-card try" id="try" style="margin-top: 1.25rem">
		<h2>Try it in 5 minutes (free test coins)</h2>
		<ol>
			<li><strong>Get a wallet.</strong> Open <a href="https://cashonize.com" target="_blank" rel="noopener">Cashonize</a> (web, extension or app), create a wallet, and in <em>Settings</em> switch the network to <strong>Chipnet</strong>.</li>
			<li><strong>Get test BCH.</strong> Copy your Chipnet address and request coins from the <a href="https://tbch.googol.cash" target="_blank" rel="noopener">Chipnet faucet</a>. They have no value.</li>
			<li><strong>Connect.</strong> Here, open <a href="/wallet">Wallet</a> and press <em>Connect Cashonize</em>. Scan the QR code, or use <em>Open in Cashonize web</em>, and approve.</li>
			<li><strong>Trade now.</strong> On the <a href="/">Exchange</a>, choose <em>Trade now → Sell BCH</em>, enter 0.001 and review. You sell into the best bid and receive test PUSD. Cashonize shows the transaction before you sign, and nothing is broadcast until you press <em>Broadcast</em>.</li>
			<li><strong>Place an order.</strong> In <em>Limit order</em>, pick a side and a deviation in BPS, such as +25. The order's price follows the live BCH/USD price, so it never goes stale. Cancel it any time from <em>My orders</em>.</li>
		</ol>
		<p class="small muted">Need test PUSD or a counterparty? Ask in the community chat (bottom-right button). Every transaction links to the Chipnet explorer.</p>
	</section>

	<section class="pp-card" style="margin-top: 1.25rem">
		<h2>How this prototype works</h2>
		<dl class="pp-kv">
			<dt>Orders</dt><dd>Each limit order is its own Bitcoin Cash covenant holding the escrow. Its price is the reference ± its BPS, so it re-prices automatically when BCH moves.</dd>
			<dt>Reference price</dt><dd>The live BCH/USD price signed by the General Protocols oracle behind <a href="https://oracles.cash" target="_blank" rel="noopener">oracles.cash</a> (key <span class="mono small">{GP_BCH_USD_ORACLE.publicKey.slice(0, 10)}…</span>). The contract verifies the signature; ParyonUSD uses the same oracle.</dd>
			<dt>Settlement</dt><dd>Every fill is checked by the order covenant with exact integer arithmetic. Amounts are rounded to 0.01 PUSD in the order maker's favour.</dd>
			<dt>Wallet</dt><dd>Cashonize over WalletConnect. Keys never leave the wallet; every transaction is previewed, signed in Cashonize and broadcast only when you press Broadcast.</dd>
			<dt>Networks</dt><dd>PennyPickerUSD trades on BCH Chipnet (test network) as a test token priced as 1 USD with no backing. ParyonUSD is the mainnet market: the same contracts with the real stablecoin, capped at 25 PUSD per order while unreviewed, and view only until mainnet trading opens.</dd>
		</dl>
	</section>

	<Mechanisms />

	<section class="pp-card" style="margin-top: 1.25rem">
		<h2>Status and disclaimers</h2>
		<ul class="small notes">
			<li>Experimental hackathon prototype. The contracts have not been security reviewed.</li>
			<li>PennyPickerUSD trades on Chipnet with test coins. ParyonUSD on mainnet is real money: view only for now, and capped per order once open.</li>
			<li>The chain cannot see the clock, so a taker can choose among oracle messages published since the last on-chain price update (minutes while the book is active).</li>
		</ul>
	</section>

	<section class="credits small muted">
		<p>
			Source code: <a href={COMMUNITY.sourceUrl} target="_blank" rel="noopener">{COMMUNITY.sourceUrl.replace('https://', '')}</a>.
			This project was forked from <a href={COMMUNITY.forkedFromUrl} target="_blank" rel="noopener">Vox</a>, an open-source collection
			of Bitcoin Cash apps by 2qx, and builds on CashScript, Libauth and Cashonize.
		</p>
	</section>
</main>

<style>
	.hero { max-width: 48rem; margin: 0.5rem 0 1rem; }
	.eyebrow { text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.75rem; color: var(--pp-accent); font-weight: 700; margin: 0; }
	.hero h1 { font-size: 2.2rem; margin: 0.2rem 0 0.1rem; }
	.tagline { font-size: 1.05rem; font-weight: 600; color: var(--pp-muted); margin: 0 0 0.9rem; }
	.lead { font-size: 1.08rem; }
	.pillars { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.9rem; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); counter-reset: pillar; }
	.pillars li { counter-increment: pillar; position: relative; padding-top: 2.6rem; }
	.pillars li::before { content: counter(pillar); position: absolute; top: 0.9rem; left: 1rem; width: 1.5rem; height: 1.5rem; border-radius: 50%; background: var(--pp-accent); color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 0.85rem; }
	.pillars h2 { font-size: 1rem; margin: 0 0 0.4rem; }
	.pillars p { margin: 0; font-size: 0.93rem; }
	.try { scroll-margin-top: 5rem; }
	.try ol { margin: 0.4rem 0 0.6rem; padding-left: 1.2rem; }
	.try li { margin: 0.35rem 0; }
	.notes { margin: 0; padding-left: 1.1rem; }
	.notes li { margin: 0.25rem 0; }
	.credits { margin: 1.5rem 0 0.5rem; border-top: 1px solid var(--pp-border); padding-top: 1rem; }
	:global(#mechanisms) { margin-top: 1.25rem; }
</style>
