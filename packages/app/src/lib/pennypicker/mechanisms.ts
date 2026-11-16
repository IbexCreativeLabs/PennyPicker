/**
 * Peer-to-peer liquidation and market-based redemption, priced from the BPS
 * orderbook (BCH/PUSD, price = PUSD per BCH). Integer arithmetic only.
 *
 * PennyPicker has no collateralised-debt (vault) covenant: PUSD is a
 * fixed-supply test token. These functions model how a vault system would use
 * the orderbook instead of fixed parameters. Every leg they return is a fill
 * the exchange covenants can actually execute at the current reference.
 *
 * Liquidation: an under-collateralised vault must buy back `debtUnits` PUSD
 * with its BCH collateral. It sells BCH into the bids (buy-BCH orders at
 * -BPS). Each bid is a standing, competing liquidation offer: the bid with the
 * smallest discount wins, and the effective penalty is the discount paid.
 *
 * Redemption: a PUSD holder exchanges PUSD for BCH by buying from the asks
 * (sell-BCH orders at +BPS), posted by vault owners or market makers. The
 * cheapest ask is the cheapest redemption; the effective fee is the premium.
 */
import {
	askFillUnitsDue,
	bidFillUnitsOut,
	BPS_DENOMINATOR,
	SETTLEMENT_SCALE,
	satsToUnits,
	unitsToSats
} from './contracts';

export interface BookOffer {
	id: string;
	side: 'ask' | 'bid';
	deltaBps: number;
	/** Ask: BCH for sale (sats). */
	availableSats?: bigint;
	/** Bid: PUSD available (base units). */
	availableUnits?: bigint;
}

export interface RoutedLeg {
	offerId: string;
	deltaBps: number;
	sats: bigint;
	units: bigint;
}

export interface Route {
	legs: RoutedLeg[];
	sats: bigint;
	units: bigint;
	/** Signed volume-weighted deviation of the routed price from the reference, in BPS. */
	effectiveBps: number;
}

function perSat(price: bigint, deltaBps: number): bigint {
	return price * (BPS_DENOMINATOR + BigInt(deltaBps));
}

function effectiveBps(sats: bigint, units: bigint, price: bigint): number {
	const referenceUnits = satsToUnits(sats, price);
	if (referenceUnits === 0n) return 0;
	return Number(((units - referenceUnits) * BPS_DENOMINATOR) / referenceUnits);
}

/** Sell BCH into the best bids until `wantUnits` PUSD is obtained. */
export function routeSellBchForUnits(book: BookOffer[], wantUnits: bigint, price: bigint): Route & { unfilledUnits: bigint } {
	const bids = book.filter((o) => o.side === 'bid' && (o.availableUnits ?? 0n) > 0n).sort((a, b) => b.deltaBps - a.deltaBps);
	const legs: RoutedLeg[] = [];
	let want = wantUnits;
	for (const bid of bids) {
		if (want <= 0n) break;
		const take = bid.availableUnits! < want ? bid.availableUnits! : want;
		// Smallest sats whose payout (rounded down) reaches `take`.
		const sats = (take * SETTLEMENT_SCALE + perSat(price, bid.deltaBps) - 1n) / perSat(price, bid.deltaBps);
		const units = bidFillUnitsOut(sats, price, bid.deltaBps);
		legs.push({ offerId: bid.id, deltaBps: bid.deltaBps, sats, units: units > take ? take : units });
		want -= take;
	}
	const sats = legs.reduce((s, l) => s + l.sats, 0n);
	const units = legs.reduce((s, l) => s + l.units, 0n);
	return { legs, sats, units, effectiveBps: effectiveBps(sats, units, price), unfilledUnits: want > 0n ? want : 0n };
}

/** Spend up to `budgetUnits` PUSD buying BCH from the cheapest asks. */
export function routeBuyBchWithUnits(book: BookOffer[], budgetUnits: bigint, price: bigint): Route & { unspentUnits: bigint } {
	const asks = book.filter((o) => o.side === 'ask' && (o.availableSats ?? 0n) > 0n).sort((a, b) => a.deltaBps - b.deltaBps);
	const legs: RoutedLeg[] = [];
	let budget = budgetUnits;
	for (const ask of asks) {
		if (budget <= 0n) break;
		let sats = (budget * SETTLEMENT_SCALE) / perSat(price, ask.deltaBps);
		if (sats > ask.availableSats!) sats = ask.availableSats!;
		while (sats > 0n && askFillUnitsDue(sats, price, ask.deltaBps) > budget) sats--;
		if (sats <= 0n) continue;
		const units = askFillUnitsDue(sats, price, ask.deltaBps);
		legs.push({ offerId: ask.id, deltaBps: ask.deltaBps, sats, units });
		budget -= units;
	}
	const sats = legs.reduce((s, l) => s + l.sats, 0n);
	const units = legs.reduce((s, l) => s + l.units, 0n);
	return { legs, sats, units, effectiveBps: effectiveBps(sats, units, price), unspentUnits: budget };
}

export interface Vault {
	collateralSats: bigint;
	debtUnits: bigint;
}

export function collateralRatioBps(vault: Vault, price: bigint): bigint {
	if (vault.debtUnits === 0n) return 0n;
	return (satsToUnits(vault.collateralSats, price) * BPS_DENOMINATOR) / vault.debtUnits;
}

export interface LiquidationQuote {
	ratioBps: bigint;
	eligible: boolean;
	route: Route & { unfilledUnits: bigint };
	collateralSpentSats: bigint;
	collateralReturnedSats: bigint;
	/** Collateral a fixed-penalty liquidation would take, for comparison. */
	fixedPenaltySpentSats: bigint;
	fullyCovered: boolean;
}

export function quoteLiquidation(vault: Vault, book: BookOffer[], price: bigint, minRatioBps: bigint, fixedPenaltyBps: bigint): LiquidationQuote {
	const ratioBps = collateralRatioBps(vault, price);
	const route = routeSellBchForUnits(book, vault.debtUnits, price);
	const debtSats = unitsToSats(vault.debtUnits, price);
	const fixed = (debtSats * (BPS_DENOMINATOR + fixedPenaltyBps)) / BPS_DENOMINATOR;
	return {
		ratioBps,
		eligible: vault.debtUnits > 0n && ratioBps < minRatioBps,
		route,
		collateralSpentSats: route.sats,
		collateralReturnedSats: vault.collateralSats > route.sats ? vault.collateralSats - route.sats : 0n,
		fixedPenaltySpentSats: fixed < vault.collateralSats ? fixed : vault.collateralSats,
		fullyCovered: route.unfilledUnits === 0n && route.sats <= vault.collateralSats
	};
}

export interface RedemptionQuote {
	route: Route & { unspentUnits: bigint };
	/** BCH a fixed-fee redemption would pay for the same PUSD. */
	fixedFeeSats: bigint;
}

export function quoteRedemption(units: bigint, book: BookOffer[], price: bigint, fixedFeeBps: bigint): RedemptionQuote {
	const route = routeBuyBchWithUnits(book, units, price);
	const reference = unitsToSats(units, price);
	return { route, fixedFeeSats: (reference * (BPS_DENOMINATOR - fixedFeeBps)) / BPS_DENOMINATOR };
}
