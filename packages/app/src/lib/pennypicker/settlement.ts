import { assertSideDelta, MAX_BCH_SATOSHIS, quoteSatoshis } from './market';
import {
	assertVerifiedOracleCategory,
	executionLimitRate,
	type VerifiedExecutionOracle
} from './executionOracle';
import {
	encodeBpsOrderCommitment,
	MAX_TOKEN_UNITS,
	type BpsOrderCommitment
} from './orderCommitment';

export interface FillLiquidity {
	/** BCH satoshis currently reserved by the order's BCH thread. */
	escrowedSatoshis: bigint;
	/** PUSD base units currently held by the order's token thread. */
	escrowedTokenUnits: bigint;
}

export interface BpsFillPreview {
	side: BpsOrderCommitment['side'];
	quantityUnits: bigint;
	remainingUnits: bigint;
	committedRemaining: Uint8Array;
	/** Exact CashToken category priced by the authenticated oracle. */
	oracleAssetCategory: string;
	oracleReferenceRateSatsPerPusdScaled: bigint;
	oracleObservedAtMs: number;
	oracleSource: string;
	limitRateSatsPerPusdScaled: bigint;
	executionRateSatsPerPusdScaled: bigint;
	bchSatoshis: bigint;
	/** Negative spends BCH escrow on buys; positive adds BCH escrow on sells. */
	orderCashDeltaSatoshis: bigint;
}

/**
 * Calculate one fill against a resting BPS order. Positive trade units fill a
 * buy-PUSD order; negative units fill a sell-PUSD order. Execution occurs at the
 * resting order's limit, rounded up to satoshis. This is a preview calculator;
 * a covenant must enforce the same predicates before this is transaction-safe.
 */
export function previewBpsFill(
	order: BpsOrderCommitment,
	tradeUnitsSigned: bigint,
	oracle: VerifiedExecutionOracle,
	expectedPusdCategory: string,
	liquidity: FillLiquidity
): BpsFillPreview {
	const oracleAssetCategory = assertVerifiedOracleCategory(oracle, expectedPusdCategory);
	assertSideDelta(order.side, order.deltaBps);
	if (order.remainingUnits < 0n || order.remainingUnits > MAX_TOKEN_UNITS) {
		throw new Error('Order remaining quantity is invalid.');
	}
	if (tradeUnitsSigned === 0n) throw new Error('A fill quantity must be non-zero.');
	if (order.side === 'buy-pusd' && tradeUnitsSigned < 0n) {
		throw new Error('A buy-PUSD order requires a positive trade quantity.');
	}
	if (order.side === 'sell-pusd' && tradeUnitsSigned > 0n) {
		throw new Error('A sell-PUSD order requires a negative trade quantity.');
	}
	const quantityUnits = tradeUnitsSigned < 0n ? -tradeUnitsSigned : tradeUnitsSigned;
	if (quantityUnits > order.remainingUnits)
		throw new Error('Fill exceeds the order’s remaining quantity.');
	if (liquidity.escrowedSatoshis < 0n || liquidity.escrowedTokenUnits < 0n) {
		throw new Error('Order liquidity cannot be negative.');
	}
	if (
		liquidity.escrowedSatoshis > MAX_BCH_SATOSHIS ||
		liquidity.escrowedTokenUnits > MAX_TOKEN_UNITS
	) {
		throw new Error('Order escrow exceeds the BCH or CashToken amount range.');
	}
	if (order.side === 'sell-pusd' && liquidity.escrowedTokenUnits < quantityUnits) {
		throw new Error('Sell order does not have enough PUSD in its token escrow.');
	}

	const limitRateSatsPerPusdScaled = executionLimitRate(
		oracle,
		order.deltaBps,
		expectedPusdCategory
	);
	const bchSatoshis = quoteSatoshis(quantityUnits, limitRateSatsPerPusdScaled);
	if (bchSatoshis > MAX_BCH_SATOSHIS) {
		throw new Error('Fill BCH amount exceeds the maximum BCH monetary supply.');
	}
	if (order.side === 'buy-pusd' && liquidity.escrowedSatoshis < bchSatoshis) {
		throw new Error('Buy order BCH escrow cannot cover this fill at its current BPS limit.');
	}
	if (order.side === 'sell-pusd' && liquidity.escrowedSatoshis + bchSatoshis > MAX_BCH_SATOSHIS) {
		throw new Error('Sell fill would exceed the maximum BCH value of the order thread.');
	}
	const remainingUnits = order.remainingUnits - quantityUnits;
	const committedRemaining = encodeBpsOrderCommitment({ ...order, remainingUnits });
	return {
		side: order.side,
		quantityUnits,
		remainingUnits,
		committedRemaining,
		oracleAssetCategory,
		oracleReferenceRateSatsPerPusdScaled: oracle.rateSatsPerPusdScaled,
		oracleObservedAtMs: oracle.observedAtMs,
		oracleSource: oracle.source,
		limitRateSatsPerPusdScaled,
		executionRateSatsPerPusdScaled: limitRateSatsPerPusdScaled,
		bchSatoshis,
		orderCashDeltaSatoshis: order.side === 'buy-pusd' ? -bchSatoshis : bchSatoshis
	};
}
