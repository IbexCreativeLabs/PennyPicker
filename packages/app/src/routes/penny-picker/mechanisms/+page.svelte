<script lang="ts">
	import { pp } from '$lib/pennypicker/ui/session.svelte';
	import { quoteLiquidation, quoteRedemption, type BookOffer } from '$lib/pennypicker/mechanisms';
	import { formatPrice, parsePrice } from '$lib/pennypicker/contracts';
	import { formatSats, formatUnits } from '$lib/pennypicker/exchange';
	import { errorText, parseBch, parsePusd } from '$lib/pennypicker/ui/wallet';

	// Illustrative book used when the live market has no orders yet.
	const demoBook: BookOffer[] = [
		{ id: 'demo bid −40', side: 'bid', deltaBps: -40, availableUnits: 5_000n },
		{ id: 'demo bid −150', side: 'bid', deltaBps: -150, availableUnits: 20_000n },
		{ id: 'demo bid −400', side: 'bid', deltaBps: -400, availableUnits: 50_000n },
		{ id: 'demo ask +30', side: 'ask', deltaBps: 30, availableSats: 3_000_000n },
		{ id: 'demo ask +120', side: 'ask', deltaBps: 120, availableSats: 50_000_000n }
	];

	let useDemo = $state(false);
	let priceOverride = $state('');

	const liveBook = $derived<BookOffer[]>(
		(pp.discovery?.orders ?? [])
			.filter((o) => !o.exhausted)
			.map((o) => ({ id: `${o.side} ${o.deltaBps > 0 ? '+' : ''}${o.deltaBps} · ${o.address.slice(9, 17)}`, side: o.side, deltaBps: o.deltaBps, availableSats: o.availableSats, availableUnits: o.availableUnits }))
	);
	const book = $derived(useDemo || liveBook.length === 0 ? demoBook : liveBook);
	const usingLive = $derived(!useDemo && liveBook.length > 0);
	const price = $derived.by(() => {
		try {
			return priceOverride.trim() ? parsePrice(priceOverride) : (pp.price ?? 500n * 100_000_000n);
		} catch {
			return pp.price ?? 500n * 100_000_000n;
		}
	});

	let collateralInput = $state('0.25');
	let debtInput = $state('110.00');
	let minRatioInput = $state('150');
	let fixedPenaltyInput = $state('10');
	let redeemInput = $state('100.00');
	let fixedFeeInput = $state('0.5');

	const pctToBps = (value: string) => {
		const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
		if (!match) throw new Error('Percent must be a number with up to 2 decimals.');
		return BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
	};
	const liquidation = $derived.by(() => {
		try {
			return { q: quoteLiquidation({ collateralSats: parseBch(collateralInput), debtUnits: parsePusd(debtInput) }, book, price, pctToBps(minRatioInput), pctToBps(fixedPenaltyInput)) };
		} catch (cause) {
			return { error: errorText(cause) };
		}
	});
	const redemption = $derived.by(() => {
		try {
			return { q: quoteRedemption(parsePusd(redeemInput), book, price, pctToBps(fixedFeeInput)) };
		} catch (cause) {
			return { error: errorText(cause) };
		}
	});
	const bps = (n: number) => `${n > 0 ? '+' : ''}${n} BPS`;
</script>

<svelte:head><title>Mechanisms · PennyPicker</title></svelte:head>

<main class="pp-container">
	<div class="pp-page-head">
		<div>
			<h1>Liquidation &amp; redemption <span class="pp-badge warn plain">Simulation</span></h1>
			<p>How a stablecoin system could use PennyPicker's orderbook instead of fixed penalties and fees. These are pricing designs, not deployed protocols.</p>
		</div>
	</div>

	<p class="pp-callout warn small">
		PUSD is a fixed-supply test token. There is no vault or debt contract, so nothing on this page can be liquidated or redeemed on-chain.
		What <em>is</em> real: each quote is routed through the BPS orderbook with the same exact integer settlement rules as the order covenant.
	</p>

	<section class="pp-card controls">
		<div class="pp-row">
			<span class="pp-badge {usingLive ? 'ok' : 'plain'}">{usingLive ? `Live Chipnet book · ${liveBook.length} orders` : 'Illustrative demo book'}</span>
			{#if liveBook.length > 0}<label class="small"><input type="checkbox" bind:checked={useDemo} /> use demo book</label>{/if}
		</div>
		<label class="pp-field price">
			<span>Reference price {pp.price && !priceOverride ? '(live oracle)' : ''}</span>
			<div class="pp-input-group"><input class="pp-input" placeholder={pp.price ? formatPrice(pp.price) : '500.00'} bind:value={priceOverride} /><span class="pp-addon">PUSD/BCH</span></div>
		</label>
	</section>

	<div class="pp-grid-2" style="margin-top: 1rem">
		<section class="pp-card">
			<h2>Competitive liquidation</h2>
			<p class="small muted">An under-collateralised vault must buy back its PUSD debt with BCH collateral. It sells into the <strong>bids</strong>. Every bid is a standing liquidation offer, and the smallest discount wins. The penalty is whatever liquidators compete it down to.</p>
			<div class="pp-grid-2 form">
				<label class="pp-field"><span>Collateral (BCH)</span><input class="pp-input" bind:value={collateralInput} /></label>
				<label class="pp-field"><span>Debt (PUSD)</span><input class="pp-input" bind:value={debtInput} /></label>
				<label class="pp-field"><span>Min. ratio %</span><input class="pp-input" bind:value={minRatioInput} /></label>
				<label class="pp-field"><span>Fixed penalty % (compare)</span><input class="pp-input" bind:value={fixedPenaltyInput} /></label>
			</div>
			{#if 'q' in liquidation && liquidation.q}
				{@const q = liquidation.q}
				<p>Collateral ratio <strong>{(Number(q.ratioBps) / 100).toFixed(2)}%</strong> <span class="pp-badge {q.eligible ? 'bad' : 'ok'}">{q.eligible ? 'Liquidatable' : 'Healthy'}</span></p>
				<div class="pp-table-wrap">
					<table class="pp-table">
						<thead><tr><th>Bid</th><th>Discount</th><th class="r">BCH sold</th><th class="r">PUSD bought</th></tr></thead>
						<tbody>
							{#each q.route.legs as leg}<tr><td class="small">{leg.offerId}</td><td>{bps(leg.deltaBps)}</td><td class="r">{formatSats(leg.sats)}</td><td class="r">{formatUnits(leg.units)}</td></tr>{/each}
						</tbody>
					</table>
				</div>
				<div class="compare">
					<div><span class="muted">Market liquidation</span><strong class="num">{formatSats(q.collateralSpentSats)} BCH</strong><span class="small muted">effective {bps(q.route.effectiveBps)}</span></div>
					<div><span class="muted">Fixed {fixedPenaltyInput}% penalty</span><strong class="num">{formatSats(q.fixedPenaltySpentSats)} BCH</strong><span class="small muted">protocol-set</span></div>
				</div>
				<p class="small">Owner keeps {formatSats(q.collateralReturnedSats)} BCH.</p>
				{#if !q.fullyCovered}<p class="pp-callout bad small">The book can't absorb the full debt ({formatUnits(q.route.unfilledUnits)} PUSD unfilled), or the collateral isn't enough. A real system would need a fallback, such as partial liquidation and a retry.</p>{/if}
			{:else if 'error' in liquidation}<p class="pp-error">{liquidation.error}</p>{/if}
		</section>

		<section class="pp-card">
			<h2>Market-based redemption</h2>
			<p class="small muted">A PUSD holder redeems by buying BCH from the <strong>asks</strong>, which are posted by vault owners or market makers. The cheapest ask is the cheapest redemption. The fee is discovered by competition rather than set by a base-rate formula.</p>
			<div class="pp-grid-2 form">
				<label class="pp-field"><span>Redeem (PUSD)</span><input class="pp-input" bind:value={redeemInput} /></label>
				<label class="pp-field"><span>Fixed fee % (compare)</span><input class="pp-input" bind:value={fixedFeeInput} /></label>
			</div>
			{#if 'q' in redemption && redemption.q}
				{@const r = redemption.q}
				<div class="pp-table-wrap">
					<table class="pp-table">
						<thead><tr><th>Ask</th><th>Premium</th><th class="r">PUSD paid</th><th class="r">BCH received</th></tr></thead>
						<tbody>
							{#each r.route.legs as leg}<tr><td class="small">{leg.offerId}</td><td>{bps(leg.deltaBps)}</td><td class="r">{formatUnits(leg.units)}</td><td class="r">{formatSats(leg.sats)}</td></tr>{/each}
						</tbody>
					</table>
				</div>
				<div class="compare">
					<div><span class="muted">Market redemption</span><strong class="num">{formatSats(r.route.sats)} BCH</strong><span class="small muted">effective {bps(r.route.effectiveBps)}</span></div>
					<div><span class="muted">Fixed {fixedFeeInput}% fee</span><strong class="num">{formatSats(r.fixedFeeSats)} BCH</strong><span class="small muted">protocol-set</span></div>
				</div>
				{#if r.route.unspentUnits > 1n}<p class="pp-callout warn small">{formatUnits(r.route.unspentUnits)} PUSD can't be redeemed against the current asks.</p>{/if}
			{:else if 'error' in redemption}<p class="pp-error">{redemption.error}</p>{/if}
		</section>
	</div>

	<details class="pp-details" style="margin-top: 1rem">
		<summary>What an on-chain version would need</summary>
		<ul class="small">
			<li>A vault covenant holding BCH collateral against minted debt. That needs a PUSD minting authority, which the fixed-supply test token deliberately lacks.</li>
			<li>A liquidation path that is valid only when the oracle state puts the ratio below the minimum. It would require the collateral to fill PennyPicker bid covenants in the same transaction and the bought PUSD to be burned.</li>
			<li>A redemption path that lets a holder burn PUSD against ask covenants posted by vault owners.</li>
			<li>The same oracle trust assumption as the exchange: the oracles.cash BCH/USD signer.</li>
		</ul>
	</details>
</main>

<style>
	.controls { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 1rem; }
	.price { width: min(100%, 18rem); }
	.form { margin: 0.75rem 0; gap: 0.6rem; }
	.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin: 0.75rem 0 0.25rem; }
	.compare > div { display: flex; flex-direction: column; border: 1px solid var(--pp-border); border-radius: var(--pp-radius-sm); padding: 0.5rem 0.65rem; background: var(--pp-surface-2); }
	.compare > div:first-child { border-color: var(--pp-accent); }
</style>
