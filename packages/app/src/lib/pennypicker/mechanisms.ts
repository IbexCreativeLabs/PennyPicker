/**
 * Peer-to-peer liquidation and market-based redemption, priced from the BPS
 * orderbook. Integer arithmetic only.
 *
 * PennyPicker has no collateralised-debt (vault) covenant: PUSD is a
 * fixed-supply test token. These functions model how a vault system would use
 * the orderbook instead of fixed parameters, and every quote they return is
 * made of fills that the exchange covenants can actually execute.
 *
 * Liquidation: an under-collateralised vault must repay `debtUnits` PUSD using
 * its BCH collateral. Instead of a fixed penalty, the debt is bought from the
 * ask side (sell-PUSD orders at +BPS). Each ask is a standing, competing
 * liquidation offer; the lowest premium wins, and the effective penalty is the
 * volume-weighted premium actually paid.
 *
 * Redemption: a PUSD holder exchanges PUSD for BCH. Instead of a fixed
 * base-rate fee, the holder sells into the bid side (buy-PUSD orders at -BPS),
 * posted by vault owners or market makers who want PUSD at a discount. The
 * highest bid is the cheapest redemption; the effective fee is the
 * volume-weighted discount.
 */
import { buyFillTakeSats, sellFillPaymentSats } from './contracts';
import { BPS_DENOMINATOR, PUSD_UNITS_PER_TOKEN, RATE_SCALE } from './market';

export interface BookOffer {
	id: string;
	side: 'buy-pusd' | 'sell-pusd';
	deltaBps: number;
	remainingUnits: bigint;
	/** Buy orders only: BCH escrow available (satoshis). */
	escrowSats?: bigint;
}

export interface RoutedLeg {
	offerId: string;
	units: bigint;
	satoshis: bigint;
	deltaBps: number;
}

export interface Route {
	legs: RoutedLeg[];
	filledUnits: bigint;
	satoshis: bigint;
	unfilledUnits: bigint;
	/** Value of the filled units at the reference, in satoshis (floor). */
	referenceSats: bigint;
	/** Signed volume-weighted deviation from the reference, in BPS (rounded toward zero). */
	effectiveBps: number;
}

function referenceValue(units: bigint, rate: bigint): bigint {
	return (units * rate) / (PUSD_UNITS_PER_TOKEN * RATE_SCALE);
}

function finishRoute(legs: RoutedLeg[], want: bigint, rate: bigint): Route {
	const filledUnits = legs.reduce((sum, leg) => sum + leg.units, 0n);
	const satoshis = legs.reduce((sum, leg) => sum + leg.satoshis, 0n);
	const referenceSats = referenceValue(filledUnits, rate);
	const effectiveBps =
		referenceSats > 0n ? Number(((satoshis - referenceSats) * BPS_DENOMINATOR) / referenceSats) : 0;
	return { legs, filledUnits, satoshis, unfilledUnits: want - filledUnits, referenceSats, effectiveBps };
}

/** Buy `units` PUSD from the cheapest asks (liquidation debt purchase). */
export function routeBuyPusd(asks: BookOffer[], units: bigint, rate: bigint): Route {
	const sorted = asks.filter((o) => o.side === 'sell-pusd' && o.remainingUnits > 0n).sort((a, b) => a.deltaBps - b.deltaBps);
	const legs: RoutedLeg[] = [];
	let want = units;
	for (const offer of sorted) {
		if (want <= 0n) break;
		const take = offer.remainingUnits < want ? offer.remainingUnits : want;
		legs.push({ offerId: offer.id, units: take, satoshis: sellFillPaymentSats(take, rate, offer.deltaBps), deltaBps: offer.deltaBps });
		want -= take;
	}
	return finishRoute(legs, units, rate);
}

/** Sell `units` PUSD into the highest bids (redemption). Respects bid escrow. */
export function routeSellPusd(bids: BookOffer[], units: bigint, rate: bigint, dustSats = 1_000n): Route {
	const sorted = bids.filter((o) => o.side === 'buy-pusd' && o.remainingUnits > 0n).sort((a, b) => b.deltaBps - a.deltaBps);
	const legs: RoutedLeg[] = [];
	let want = units;
	for (const offer of sorted) {
		if (want <= 0n) break;
		let take = offer.remainingUnits < want ? offer.remainingUnits : want;
		const escrow = offer.escrowSats;
		if (escrow !== undefined) {
			// Largest quantity the remaining escrow can pay for (binary search).
			let lo = 0n;
			let hi = take;
			while (lo < hi) {
				const mid = (lo + hi + 1n) / 2n;
				if (buyFillTakeSats(mid, rate, offer.deltaBps) <= escrow - dustSats) lo = mid;
				else hi = mid - 1n;
			}
			take = lo;
		}
		if (take <= 0n) continue;
		legs.push({ offerId: offer.id, units: take, satoshis: buyFillTakeSats(take, rate, offer.deltaBps), deltaBps: offer.deltaBps });
		want -= take;
	}
	return finishRoute(legs, units, rate);
}

export interface Vault {
	collateralSats: bigint;
	debtUnits: bigint;
}

export interface LiquidationQuote {
	/** Collateral ratio in BPS (collateral value / debt value × 10000). */
	ratioBps: bigint;
	eligible: boolean;
	route: Route;
	/** Collateral consumed buying the debt through the book. */
	collateralSpentSats: bigint;
	/** Collateral returned to the vault owner after full repayment. */
	collateralReturnedSats: bigint;
	/** Collateral a fixed-penalty liquidation would have taken for comparison. */
	fixedPenaltySpentSats: bigint;
	fullyCovered: boolean;
}

export function collateralRatioBps(vault: Vault, rate: bigint): bigint {
	const debtValue = referenceValue(vault.debtUnits, rate);
	if (debtValue === 0n) return 0n;
	return (vault.collateralSats * BPS_DENOMINATOR) / debtValue;
}

export function quoteLiquidation(
	vault: Vault,
	asks: BookOffer[],
	rate: bigint,
	minRatioBps: bigint,
	fixedPenaltyBps: bigint
): LiquidationQuote {
	const ratioBps = collateralRatioBps(vault, rate);
	const route = routeBuyPusd(asks, vault.debtUnits, rate);
	const fullyCovered = route.unfilledUnits === 0n && route.satoshis <= vault.collateralSats;
	const debtValue = referenceValue(vault.debtUnits, rate);
	const fixed = (debtValue * (BPS_DENOMINATOR + fixedPenaltyBps)) / BPS_DENOMINATOR;
	return {
		ratioBps,
		eligible: vault.debtUnits > 0n && ratioBps < minRatioBps,
		route,
		collateralSpentSats: route.satoshis,
		collateralReturnedSats: vault.collateralSats > route.satoshis ? vault.collateralSats - route.satoshis : 0n,
		fixedPenaltySpentSats: fixed < vault.collateralSats ? fixed : vault.collateralSats,
		fullyCovered
	};
}

export interface RedemptionQuote {
	route: Route;
	/** BCH a fixed base-rate redemption would pay for the same PUSD. */
	fixedFeeSats: bigint;
}

export function quoteRedemption(units: bigint, bids: BookOffer[], rate: bigint, fixedFeeBps: bigint, dustSats?: bigint): RedemptionQuote {
	const route = routeSellPusd(bids, units, rate, dustSats);
	const reference = referenceValue(units, rate);
	return { route, fixedFeeSats: (reference * (BPS_DENOMINATOR - fixedFeeBps)) / BPS_DENOMINATOR };
}
