<script lang="ts">
	/**
	 * Visual explainer for the floating order book: the live reference price in the middle, real resting orders placed
	 * by their BPS offset, and a marker for the order being drafted. Pure display, built from real book data.
	 */
	import { formatPrice, limitPrice } from '$lib/pennypicker/contracts';

	interface Marker {
		deltaBps: number;
		side: 'bid' | 'ask';
	}
	interface Props {
		price: bigint | undefined;
		orders: Marker[];
		/** The order being drafted in the form, if its BPS is valid. */
		draft?: Marker;
		loading?: boolean;
	}
	let { price, orders, draft, loading = false }: Props = $props();

	/** Half-width of the axis in BPS: fits every order and the draft, at least ±60, rounded up to a multiple of 20. */
	const range = $derived.by(() => {
		const extremes = [60, ...orders.map((o) => Math.abs(o.deltaBps)), draft ? Math.abs(draft.deltaBps) : 0];
		return Math.ceil((Math.max(...extremes) * 1.12) / 20) * 20;
	});
	const pos = (bps: number) => `${50 + (Math.max(-range, Math.min(range, bps)) / range) * 50}%`;
	const ticks = $derived([-range, -range / 2, 0, range / 2, range]);
	const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
</script>

<div class="scale" class:loading aria-label="Orders positioned by basis points around the live oracle price">
	<div class="zones" aria-hidden="true">
		<span class="zone bid-zone">Bids · buy BCH below the price</span>
		<span class="zone ask-zone">Asks · sell BCH above the price</span>
	</div>
	<div class="track">
		<div class="half bid-half"></div>
		<div class="half ask-half"></div>
		{#each orders as o, i (i)}
			<span class="dot {o.side}" style="left: {pos(o.deltaBps)}" title="{o.side === 'ask' ? 'Ask' : 'Bid'} at {sign(o.deltaBps)} BPS"></span>
		{/each}
		<div class="ref" style="left: 50%">
			<span class="ref-label"><span class="pp-live"></span>{loading || !price ? 'Loading price…' : formatPrice(price)}</span>
		</div>
		{#if draft}
			<div class="draft" style="left: {pos(draft.deltaBps)}">
				<span class="diamond" aria-hidden="true"></span>
				<span class="draft-label" class:flip={draft.deltaBps > range * 0.35} class:flip-l={draft.deltaBps < -range * 0.35}>Your order {sign(draft.deltaBps)}{price ? ` → ${formatPrice(limitPrice(price, draft.deltaBps))}` : ''}</span>
			</div>
		{/if}
	</div>
	<div class="ticks" aria-hidden="true">
		{#each ticks as t (t)}
			<span class="tick" style="left: {pos(t)}">
				<b>{t === 0 ? '0' : sign(t)}</b>
				{#if price && t !== 0}<small>{formatPrice(limitPrice(price, t))}</small>{:else if t === 0}<small>BPS</small>{/if}
			</span>
		{/each}
	</div>
</div>

<style>
	.scale { position: relative; padding: 0.2rem 0.4rem 0; }
	.zones { display: flex; justify-content: space-between; font-size: 0.72rem; font-weight: 600; margin-bottom: 1.6rem; }
	.bid-zone { color: var(--pp-bid); }
	.ask-zone { color: var(--pp-ask); text-align: right; }
	.track { position: relative; height: 12px; border-radius: 999px; display: flex; overflow: visible; }
	.half { flex: 1; height: 100%; }
	.bid-half { background: linear-gradient(90deg, transparent, var(--pp-bid-soft)); border-radius: 999px 0 0 999px; }
	.ask-half { background: linear-gradient(90deg, var(--pp-ask-soft), transparent); border-radius: 0 999px 999px 0; }
	.dot { position: absolute; top: 50%; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; border: 2px solid var(--pp-surface); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25); }
	.dot.bid { background: var(--pp-bid); }
	.dot.ask { background: var(--pp-ask); }
	.ref { position: absolute; top: -10px; bottom: -10px; width: 2px; margin-left: -1px; background: var(--pp-text); border-radius: 2px; }
	.ref-label { position: absolute; bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%); white-space: nowrap; font-size: 0.78rem; font-weight: 700; font-variant-numeric: tabular-nums; display: inline-flex; align-items: center; gap: 0.3rem; background: var(--pp-surface); padding: 0 0.3rem; border-radius: 6px; }
	.draft { position: absolute; top: 50%; width: 0; height: 0; z-index: 2; transition: left 0.25s ease; }
	.diamond { position: absolute; width: 16px; height: 16px; left: -8px; top: -8px; transform: rotate(45deg); border-radius: 4px; background: var(--pp-brand); border: 2px solid var(--pp-surface); box-shadow: 0 0 0 3px var(--pp-accent-soft); }
	.draft-label { position: absolute; top: 12px; left: 0; transform: translateX(-50%); white-space: nowrap; font-size: 0.72rem; font-weight: 700; color: var(--pp-accent); background: var(--pp-surface); padding: 0.05rem 0.3rem; border-radius: 4px; border: 1px solid var(--pp-accent-soft); }
	.draft-label.flip { transform: translateX(-100%); }
	.draft-label.flip-l { transform: none; }
	.ticks { position: relative; height: 2.4rem; margin-top: 1.9rem; }
	.tick { position: absolute; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; line-height: 1.15; font-variant-numeric: tabular-nums; }
	.tick:first-child { transform: none; align-items: flex-start; }
	.tick:last-child { transform: translateX(-100%); align-items: flex-end; }
	.tick b { font-size: 0.72rem; color: var(--pp-muted); font-weight: 600; }
	.tick small { font-size: 0.68rem; color: var(--pp-faint, var(--pp-muted)); }
	.loading .track { opacity: 0.5; }
	@media (prefers-reduced-motion: reduce) { .draft { transition: none; } }
</style>
