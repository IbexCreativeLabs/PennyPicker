<script lang="ts">
	import { onMount } from 'svelte';
	import { discoverOrders, getOracleState, isCompleteMarket, loadMarketConfig } from '$lib/pennypicker/chain';
	import { quoteLiquidation, quoteRedemption, type BookOffer } from '$lib/pennypicker/mechanisms';
	import { formatBchFromSatoshis, formatPusd } from '$lib/pennypicker/market';
	import { errorText, formatPusdPerBch, parseBch, parsePusd, rateFromPusdPerBch } from '$lib/pennypicker/ui/wallet';

	// Illustrative book used when no Chipnet market is configured.
	const demoBook: BookOffer[] = [
		{ id: 'demo-ask-40', side: 'sell-pusd', deltaBps: 40, remainingUnits: 10_000n },
		{ id: 'demo-ask-150', side: 'sell-pusd', deltaBps: 150, remainingUnits: 20_000n },
		{ id: 'demo-ask-400', side: 'sell-pusd', deltaBps: 400, remainingUnits: 50_000n },
		{ id: 'demo-bid-30', side: 'buy-pusd', deltaBps: -30, remainingUnits: 5_000n, escrowSats: 30_000_000n },
		{ id: 'demo-bid-120', side: 'buy-pusd', deltaBps: -120, remainingUnits: 50_000n, escrowSats: 500_000_000n }
	];

	let book = $state<BookOffer[]>(demoBook);
	let bookSource = $state('Illustrative demo book (no Chipnet market configured).');
	let priceInput = $state('500.00');
	let error = $state('');

	let collateralInput = $state('0.25');
	let debtInput = $state('110.00');
	let minRatioInput = $state('150');
	let fixedPenaltyInput = $state('10');

	let redeemInput = $state('100.00');
	let fixedFeeInput = $state('0.5');

	onMount(async () => {
		const config = loadMarketConfig();
		if (!isCompleteMarket(config)) return;
		try {
			const oracle = await getOracleState(config);
			if (oracle) priceInput = formatPusdPerBch(oracle.state.rateSatsPerPusdScaled);
			const { orders } = await discoverOrders(config);
			book = orders.map((o) => ({
				id: o.address,
				side: o.side,
				deltaBps: o.deltaBps,
				remainingUnits: o.remainingUnits,
				escrowSats: o.side === 'buy-pusd' ? o.utxo.satoshis : undefined
			}));
			bookSource = `Live Chipnet orderbook (${orders.length} open orders) and on-chain reference.`;
		} catch (cause) {
			error = `Could not load the live book: ${errorText(cause)}. Using the demo book.`;
		}
	});

	const pctToBps = (value: string) => {
		const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
		if (!match) throw new Error('Percent must be a number with up to 2 decimals.');
		return BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
	};

	const liquidation = $derived.by(() => {
		try {
			const rate = rateFromPusdPerBch(priceInput);
			return {
				rate,
				quote: quoteLiquidation(
					{ collateralSats: parseBch(collateralInput), debtUnits: parsePusd(debtInput) },
					book,
					rate,
					pctToBps(minRatioInput),
					pctToBps(fixedPenaltyInput)
				)
			};
		} catch (cause) {
			return { error: errorText(cause) };
		}
	});

	const redemption = $derived.by(() => {
		try {
			const rate = rateFromPusdPerBch(priceInput);
			return { quote: quoteRedemption(parsePusd(redeemInput), book, rate, pctToBps(fixedFeeInput)) };
		} catch (cause) {
			return { error: errorText(cause) };
		}
	});
	const bps = (n: number | bigint) => `${Number(n) > 0 ? '+' : ''}${n} BPS`;
</script>

<svelte:head><title>PennyPicker liquidation &amp; redemption</title></svelte:head>

<main>
	<p><a href="/penny-picker/exchange">← Exchange</a></p>
	<h1>Peer-to-peer liquidation &amp; market-based redemption</h1>
	<p class="notice">
		<strong>Design simulation.</strong> PUSD is a fixed-supply test token. No vault/CDP covenant exists, so nothing here can
		be liquidated or redeemed on-chain. What is real: the quotes are routed through the BPS orderbook, using the same exact
		integer settlement rules as the order covenant, so each leg is a fill the exchange could execute today.
	</p>
	<p class="hint">{bookSource}</p>
	{#if error}<p class="error">{error}</p>{/if}
	<label>Reference price (PUSD per BCH) <input bind:value={priceInput} size="10" /></label>

	<section>
		<h2>Liquidation: competing offers replace a fixed penalty</h2>
		<p>
			Each <em>ask</em> (sell-PUSD order at +BPS) is a standing offer to supply PUSD for BCH at a premium to the reference. A
			liquidation must buy back the vault's debt, so it fills the lowest premiums first. Liquidators compete by lowering their
			premium; the market sets the penalty. There is no protocol-chosen penalty.
		</p>
		<div class="form">
			<label>Collateral (BCH) <input bind:value={collateralInput} size="10" /></label>
			<label>Debt (PUSD) <input bind:value={debtInput} size="10" /></label>
			<label>Minimum ratio % <input bind:value={minRatioInput} size="5" /></label>
			<label>Fixed penalty for comparison % <input bind:value={fixedPenaltyInput} size="5" /></label>
		</div>
		{#if 'quote' in liquidation && liquidation.quote}
			{@const q = liquidation.quote}
			<p>
				Collateral ratio <strong>{(Number(q.ratioBps) / 100).toFixed(2)}%</strong> —
				{q.eligible ? 'eligible for liquidation' : 'healthy (not eligible)'}.
			</p>
			<table>
				<thead><tr><th>Offer</th><th>Premium</th><th>PUSD</th><th>BCH paid</th></tr></thead>
				<tbody>
					{#each q.route.legs as leg}
						<tr><td>{leg.offerId.slice(0, 24)}</td><td>{bps(leg.deltaBps)}</td><td>{formatPusd(leg.units)}</td><td>{formatBchFromSatoshis(leg.satoshis)}</td></tr>
					{/each}
				</tbody>
			</table>
			<ul>
				<li>Market liquidation spends <strong>{formatBchFromSatoshis(q.collateralSpentSats)} BCH</strong> (effective {bps(q.route.effectiveBps)}); returns {formatBchFromSatoshis(q.collateralReturnedSats)} BCH to the owner.</li>
				<li>Fixed {fixedPenaltyInput}% penalty would spend {formatBchFromSatoshis(q.fixedPenaltySpentSats)} BCH.</li>
				{#if !q.fullyCovered}<li class="error">The book cannot absorb the full debt ({formatPusd(q.route.unfilledUnits)} PUSD unfilled) or collateral is insufficient — a real system needs a fallback (e.g. partial liquidation and retry).</li>{/if}
			</ul>
		{:else if 'error' in liquidation}
			<p class="error">{liquidation.error}</p>
		{/if}
	</section>

	<section>
		<h2>Redemption: market bids replace a base-rate fee</h2>
		<p>
			Each <em>bid</em> (buy-PUSD order at −BPS) is an offer to take PUSD for BCH at a discount. A redeemer sells into the
			highest bids, limited by each bid's BCH escrow. Bidders (e.g. vault owners wanting to deleverage) compete by narrowing
			their discount, so the redemption fee is discovered rather than set by a formula.
		</p>
		<div class="form">
			<label>Redeem (PUSD) <input bind:value={redeemInput} size="10" /></label>
			<label>Fixed fee for comparison % <input bind:value={fixedFeeInput} size="5" /></label>
		</div>
		{#if 'quote' in redemption && redemption.quote}
			{@const r = redemption.quote}
			<table>
				<thead><tr><th>Bid</th><th>Discount</th><th>PUSD</th><th>BCH received</th></tr></thead>
				<tbody>
					{#each r.route.legs as leg}
						<tr><td>{leg.offerId.slice(0, 24)}</td><td>{bps(leg.deltaBps)}</td><td>{formatPusd(leg.units)}</td><td>{formatBchFromSatoshis(leg.satoshis)}</td></tr>
					{/each}
				</tbody>
			</table>
			<ul>
				<li>Market redemption pays <strong>{formatBchFromSatoshis(r.route.satoshis)} BCH</strong> for {formatPusd(r.route.filledUnits)} PUSD (effective {bps(r.route.effectiveBps)}).</li>
				<li>Fixed {fixedFeeInput}% fee would pay {formatBchFromSatoshis(r.fixedFeeSats)} BCH for the full amount.</li>
				{#if r.route.unfilledUnits > 0n}<li class="error">{formatPusd(r.route.unfilledUnits)} PUSD cannot be redeemed against current bids.</li>{/if}
			</ul>
		{:else if 'error' in redemption}
			<p class="error">{redemption.error}</p>
		{/if}
	</section>

	<section>
		<h2>What an on-chain version would need</h2>
		<ul>
			<li>A vault covenant holding BCH collateral against minted debt (requires a PUSD minting authority, which the fixed-supply test token deliberately lacks).</li>
			<li>A liquidation path that is valid only when the oracle state shows the ratio below the minimum, and that requires the vault's collateral to fill PennyPicker ask covenants in the same transaction, with the bought PUSD burned.</li>
			<li>A redemption path that lets a holder burn PUSD against bid covenants posted by vault owners.</li>
			<li>The same oracle trust assumption as the exchange: the operator's latest published state.</li>
		</ul>
	</section>
</main>

<style>
	main { max-width: 56rem; margin: 0 auto; padding: 1rem; }
	.notice { background: #fff4d6; border-left: 4px solid #c08a1e; padding: 0.75rem; }
	.form { display: flex; flex-wrap: wrap; gap: 0.5rem 1.25rem; }
	table { border-collapse: collapse; margin: 0.5rem 0; font-size: 0.9rem; }
	th, td { text-align: left; padding: 0.2rem 0.6rem; border-bottom: 1px solid #eee; }
	.error { color: #a00; }
	.hint { color: #555; font-size: 0.9rem; }
	section { margin: 1.5rem 0; }
</style>
