/**
 * Integer-only BCH/PUSD market primitives.
 *
 * Rates use fixed-point satoshis per whole PUSD, scaled by 1e8. PUSD quantities
 * are token base units (100 units per whole PUSD); BCH quantities are satoshis.
 */
export const BPS_DENOMINATOR = 10_000n;
export const PUSD_UNITS_PER_TOKEN = 100n;
export const RATE_SCALE = 100_000_000n;
export const SATS_PER_BCH = 100_000_000n;
export const MAX_ORACLE_AGE_MS = 5 * 60 * 1000;

export type OrderSide = 'buy-pusd' | 'sell-pusd';

export interface OracleObservation {
	pair: 'BCH/PUSD';
	/** Fixed-point satoshis paid for one whole PUSD, scaled by RATE_SCALE. */
	rateSatsPerPusdScaled: bigint;
	observedAtMs: number;
	source: string;
	confidence: 'production' | 'development';
}

export interface BpsOrderDraft {
	id: string;
	side: OrderSide;
	/** Signed basis-point delta from the oracle rate. */
	deltaBps: number;
	/** PUSD base units, where 100 units = 1 PUSD. */
	quantityUnits: bigint;
	remainingUnits: bigint;
	createdAtMs: number;
	createdAgainst: OracleObservation;
}

export interface PricedOrder extends BpsOrderDraft {
	limitRateSatsPerPusdScaled: bigint;
}

export function assertFreshOracle(
	observation: OracleObservation,
	nowMs = Date.now(),
	maxAgeMs = MAX_ORACLE_AGE_MS
): void {
	if (observation.pair !== 'BCH/PUSD') throw new Error('Oracle pair must be BCH/PUSD.');
	if (observation.rateSatsPerPusdScaled <= 0n) throw new Error('Oracle rate must be positive.');
	if (!Number.isSafeInteger(observation.observedAtMs) || observation.observedAtMs <= 0) {
		throw new Error('Oracle timestamp is invalid.');
	}
	if (observation.observedAtMs > nowMs + 30_000) throw new Error('Oracle timestamp is in the future.');
	if (nowMs - observation.observedAtMs > maxAgeMs) throw new Error('Oracle price is stale.');
}

/** Floor the limit rate to the supported fixed-point precision. */
export function rateAtDeltaBps(referenceRate: bigint, deltaBps: number): bigint {
	if (referenceRate <= 0n) throw new Error('Reference rate must be positive.');
	if (!Number.isSafeInteger(deltaBps) || deltaBps <= -10_000 || deltaBps > 1_000_000) {
		throw new Error('BPS delta is outside the supported range.');
	}
	const result = (referenceRate * (BPS_DENOMINATOR + BigInt(deltaBps))) / BPS_DENOMINATOR;
	if (result <= 0n) throw new Error('BPS delta rounds the limit price to zero.');
	return result;
}

export function createOrder(
	input: Pick<BpsOrderDraft, 'id' | 'side' | 'deltaBps' | 'quantityUnits'>,
	oracle: OracleObservation,
	nowMs = Date.now()
): PricedOrder {
	assertFreshOracle(oracle, nowMs);
	if (!input.id.trim()) throw new Error('Order ID is required.');
	if (input.quantityUnits <= 0n) throw new Error('Order quantity must be positive.');
	const limitRateSatsPerPusdScaled = rateAtDeltaBps(
		oracle.rateSatsPerPusdScaled,
		input.deltaBps
	);
	return {
		...input,
		remainingUnits: input.quantityUnits,
		createdAtMs: nowMs,
		createdAgainst: { ...oracle },
		limitRateSatsPerPusdScaled
	};
}

/**
 * Convert PUSD base units to satoshis at a fixed-point rate. Round upward so
 * sub-satoshi dust never causes the quoted BCH payment to fall below the limit.
 */
export function quoteSatoshis(pusdUnits: bigint, rateSatsPerPusdScaled: bigint): bigint {
	if (pusdUnits < 0n) throw new Error('PUSD quantity cannot be negative.');
	if (rateSatsPerPusdScaled <= 0n) throw new Error('Rate must be positive.');
	const numerator = pusdUnits * rateSatsPerPusdScaled;
	const denominator = PUSD_UNITS_PER_TOKEN * RATE_SCALE;
	return (numerator + denominator - 1n) / denominator;
}

export function formatPusd(units: bigint): string {
	const whole = units / PUSD_UNITS_PER_TOKEN;
	const cents = (units % PUSD_UNITS_PER_TOKEN).toString().padStart(2, '0');
	return `${whole}.${cents}`;
}

export function formatBchFromSatoshis(satoshis: bigint): string {
	const whole = satoshis / SATS_PER_BCH;
	const fraction = (satoshis % SATS_PER_BCH).toString().padStart(8, '0');
	return `${whole}.${fraction}`;
}

export function formatRate(rateSatsPerPusdScaled: bigint, decimals = 2): string {
	const divisor = RATE_SCALE * 10n ** BigInt(decimals);
	const rounded = (rateSatsPerPusdScaled * 10n ** BigInt(decimals) + RATE_SCALE / 2n) / RATE_SCALE;
	const whole = rounded / 10n ** BigInt(decimals);
	const fraction = (rounded % 10n ** BigInt(decimals)).toString().padStart(decimals, '0');
	return `${whole}.${fraction}`;
}

export interface Fill {
	buyOrderId: string;
	sellOrderId: string;
	quantityUnits: bigint;
	priceSatsPerPusdScaled: bigint;
	bchSatoshis: bigint;
}

export interface MatchResult {
	fills: Fill[];
	remaining: BpsOrderDraft[];
}

/**
 * Simulate price-time matching at the resting (older) order's limit. The fresh
 * oracle observation reprices each signed BPS delta before any crossing test.
 */
export function matchOrders(
	orders: BpsOrderDraft[],
	oracle: OracleObservation,
	nowMs = Date.now()
): MatchResult {
	assertFreshOracle(oracle, nowMs);
	const priced = orders
		.filter((order) => order.remainingUnits > 0n)
		.map((order) => ({
			...order,
			limitRateSatsPerPusdScaled: rateAtDeltaBps(
				oracle.rateSatsPerPusdScaled,
				order.deltaBps
			)
		}));
	const buys = priced
		.filter((order) => order.side === 'buy-pusd')
		.sort((a, b) => a.limitRateSatsPerPusdScaled === b.limitRateSatsPerPusdScaled
			? a.createdAtMs - b.createdAtMs
			: a.limitRateSatsPerPusdScaled > b.limitRateSatsPerPusdScaled ? -1 : 1);
	const sells = priced
		.filter((order) => order.side === 'sell-pusd')
		.sort((a, b) => a.limitRateSatsPerPusdScaled === b.limitRateSatsPerPusdScaled
			? a.createdAtMs - b.createdAtMs
			: a.limitRateSatsPerPusdScaled < b.limitRateSatsPerPusdScaled ? -1 : 1);
	const fills: Fill[] = [];
	const remainingById = new Map(priced.map((order) => [order.id, order.remainingUnits]));
	let buyIndex = 0;
	let sellIndex = 0;
	while (buyIndex < buys.length && sellIndex < sells.length) {
		const buy = buys[buyIndex]!;
		const sell = sells[sellIndex]!;
		if (buy.limitRateSatsPerPusdScaled < sell.limitRateSatsPerPusdScaled) break;
		const quantityUnits = remainingById.get(buy.id)! < remainingById.get(sell.id)!
			? remainingById.get(buy.id)!
			: remainingById.get(sell.id)!;
		const maker = buy.createdAtMs <= sell.createdAtMs ? buy : sell;
		fills.push({
			buyOrderId: buy.id,
			sellOrderId: sell.id,
			quantityUnits,
			priceSatsPerPusdScaled: maker.limitRateSatsPerPusdScaled,
			bchSatoshis: quoteSatoshis(quantityUnits, maker.limitRateSatsPerPusdScaled)
		});
		remainingById.set(buy.id, remainingById.get(buy.id)! - quantityUnits);
		remainingById.set(sell.id, remainingById.get(sell.id)! - quantityUnits);
		if (remainingById.get(buy.id) === 0n) buyIndex++;
		if (remainingById.get(sell.id) === 0n) sellIndex++;
	}
	return {
		fills,
		remaining: priced.map(({ limitRateSatsPerPusdScaled: _limit, ...order }) => ({
			...order,
			remainingUnits: remainingById.get(order.id)!
		}))
	};
}
