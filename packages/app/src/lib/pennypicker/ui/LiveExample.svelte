<script lang="ts">
	/**
	 * A 30-second worked example with today's live oracle price, for visitors (and judges) with little time.
	 * Pure arithmetic on the current reference; nothing is built or signed.
	 */
	import { formatPrice, limitPrice, PRICE_SCALE } from '$lib/pennypicker/contracts';
	import { pp } from './session.svelte';

	interface Props {
		/** Show the "try it" button that pre-fills the Exchange form. */
		cta?: boolean;
		compact?: boolean;
	}
	let { cta = true, compact = false }: Props = $props();

	const BPS = -50;
	const SELL_SATS = 1_000_000n; // 0.01 BCH
	const fallback = 400n * PRICE_SCALE;
	const live = $derived(pp.price ?? pp.displayPrice);
	const price = $derived(live ?? fallback);
	const bid = $derived(limitPrice(price, BPS));
	const moved = $derived((price * 101n) / 100n);
	const movedBid = $derived(limitPrice(moved, BPS));
	/** PUSD cents paid for 0.01 BCH at the moved bid price (rounded down, maker's favour). */
	const paidCents = $derived((SELL_SATS * movedBid) / (PRICE_SCALE * 1_000_000n));
	const pusd = (cents: bigint) => `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
</script>

<div class="ex" class:compact>
	<ol class="story">
		<li>
			<span class="who oracle" aria-hidden="true">◷</span>
			<div><strong>The oracle signs the price</strong><span>oracles.cash: 1 BCH = <b class="num">{formatPrice(price)}</b> USD{live ? ' (live now)' : ' (example)'}</span></div>
		</li>
		<li>
			<span class="who alice" aria-hidden="true">A</span>
			<div><strong>Alice bids at −50 BPS</strong><span>"Buy BCH 0.5% below the oracle" → her price is <b class="num bid">{formatPrice(bid)}</b></span></div>
		</li>
		<li>
			<span class="who move" aria-hidden="true">↑</span>
			<div><strong>BCH rises 1% to {formatPrice(moved)}</strong><span>Alice's bid follows by itself to <b class="num bid">{formatPrice(movedBid)}</b>. She does nothing.</span></div>
		</li>
		<li>
			<span class="who bob" aria-hidden="true">B</span>
			<div><strong>Bob sells 0.01 BCH into it</strong><span>He receives <b class="num">{pusd(paidCents)} PUSD</b>. The same transaction puts the newest signed price on-chain, and the contract checks the maths.</span></div>
		</li>
	</ol>
	{#if cta}
		<div class="cta">
			<a class="pp-btn pp-btn-primary pp-btn-sm" href="/?side=bid&bps=-50">Try it: pre-fill a −50 BPS bid →</a>
			<span class="small faint">{pp.networkInfo.realFunds ? 'This market is real money on mainnet; choose PennyPickerUSD (Chipnet) in the header to try it free.' : 'On Chipnet with free test coins. You review everything before signing.'}</span>
		</div>
	{/if}
</div>

<style>
	.story { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.55rem; position: relative; }
	.story li { display: grid; grid-template-columns: 2rem 1fr; gap: 0.7rem; align-items: start; position: relative; }
	.story li:not(:last-child)::after { content: ''; position: absolute; left: calc(1rem - 1px); top: 2.1rem; bottom: -0.55rem; width: 2px; background: var(--pp-border); }
	.story div { display: flex; flex-direction: column; gap: 0.1rem; font-size: 0.92rem; line-height: 1.45; padding-top: 0.2rem; }
	.story span { color: var(--pp-muted); }
	.who { width: 2rem; height: 2rem; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 0.9rem; z-index: 1; }
	.oracle { background: var(--pp-info-soft); color: #2f5b9a; }
	.alice { background: var(--pp-bid-soft); color: var(--pp-bid); }
	.move { background: var(--pp-accent-soft); color: var(--pp-accent); }
	.bob { background: var(--pp-ask-soft); color: var(--pp-ask); }
	b.bid { color: var(--pp-bid); }
	b { color: var(--pp-text); font-weight: 650; }
	.cta { display: flex; flex-wrap: wrap; gap: 0.5rem 0.9rem; align-items: center; margin-top: 0.9rem; }
	.compact .story div { font-size: 0.88rem; }
</style>
