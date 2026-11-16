import { assertSideDelta, MAX_BCH_SATOSHIS, MAX_TOKEN_UNITS, quoteSatoshis } from './market';
import {
	assertVerifiedOracleCategory,
	executionLimitRate,
	type VerifiedExecutionOracle
} from './executionOracle';
import type { BpsOrderCommitment } from './orderCommitment';

/** Fee and dust policy supplied by the transaction builder; never guessed here. */
export interface OrderFundingPolicy {
	/** Expected deployed PUSD CashToken category, not taken from the oracle itself. */
	pusdAssetCategory: string;
	orderThreadDustSats: bigint;
	assetThreadDustSats: bigint;
	feeReserveSats: bigint;
	/** Optional BCH reserve above the current buy-order quote. */
	buyPriceBufferSats?: bigint;
}

/** Amounts the future order-creation builder must fund. This is not a transaction. */
export interface BpsOrderFundingPlan {
	side: BpsOrderCommitment['side'];
	quantityUnits: bigint;
	deltaBps: number;
	oracleAssetCategory: string;
	oracleRateSatsPerPusdScaled: bigint;
	limitRateSatsPerPusdScaled: bigint;
	orderThreadDustSats: bigint;
	orderThreadTradeEscrowSats: bigint;
	orderThreadOutputSats: bigint;
	assetThreadDustSats: bigint;
	assetThreadPusdUnits: bigint;
	feeReserveSats: bigint;
	minimumBchFundingSats: bigint;
	minimumPusdFundingUnits: bigint;
}

/**
 * Calculate order-thread and asset-thread funding for a BPS order.
 * Buy orders escrow the current quote plus an explicit optional buffer; sell
 * orders escrow the full PUSD quantity. A later oracle move can make a buy order
 * temporarily unfillable, but cannot make it spend more than its BCH escrow.
 */
export function planBpsOrderFunding(
	order: BpsOrderCommitment,
	oracle: VerifiedExecutionOracle,
	policy: OrderFundingPolicy
): BpsOrderFundingPlan {
	const oracleAssetCategory = assertVerifiedOracleCategory(oracle, policy.pusdAssetCategory);
	assertSideDelta(order.side, order.deltaBps);
	if (order.remainingUnits <= 0n || order.remainingUnits > MAX_TOKEN_UNITS) {
		throw new Error('Order quantity must fit the CashToken amount range and be positive.');
	}
	for (const [name, value] of [
		['order thread dust', policy.orderThreadDustSats],
		['asset thread dust', policy.assetThreadDustSats]
	] as const) {
		if (value <= 0n || value > MAX_BCH_SATOSHIS) {
			throw new Error(`${name} must be positive and within the BCH monetary supply.`);
		}
	}
	if (policy.feeReserveSats < 0n || policy.feeReserveSats > MAX_BCH_SATOSHIS) {
		throw new Error('Fee reserve is outside the BCH monetary supply.');
	}
	const buyPriceBufferSats = policy.buyPriceBufferSats ?? 0n;
	if (buyPriceBufferSats < 0n || buyPriceBufferSats > MAX_BCH_SATOSHIS) {
		throw new Error('Buy price buffer is outside the BCH monetary supply.');
	}
	const limitRateSatsPerPusdScaled = executionLimitRate(
		oracle,
		order.deltaBps,
		policy.pusdAssetCategory
	);
	const orderThreadTradeEscrowSats =
		order.side === 'buy-pusd'
			? quoteSatoshis(order.remainingUnits, limitRateSatsPerPusdScaled) + buyPriceBufferSats
			: 0n;
	const orderThreadOutputSats = policy.orderThreadDustSats + orderThreadTradeEscrowSats;
	const assetThreadPusdUnits = order.side === 'sell-pusd' ? order.remainingUnits : 0n;
	const minimumBchFundingSats =
		orderThreadOutputSats + policy.assetThreadDustSats + policy.feeReserveSats;
	if (
		orderThreadTradeEscrowSats > MAX_BCH_SATOSHIS ||
		orderThreadOutputSats > MAX_BCH_SATOSHIS ||
		minimumBchFundingSats > MAX_BCH_SATOSHIS
	) {
		throw new Error('Required BCH escrow and fees exceed the maximum monetary supply.');
	}
	return {
		side: order.side,
		quantityUnits: order.remainingUnits,
		deltaBps: order.deltaBps,
		oracleAssetCategory,
		oracleRateSatsPerPusdScaled: oracle.rateSatsPerPusdScaled,
		limitRateSatsPerPusdScaled,
		orderThreadDustSats: policy.orderThreadDustSats,
		orderThreadTradeEscrowSats,
		orderThreadOutputSats,
		assetThreadDustSats: policy.assetThreadDustSats,
		assetThreadPusdUnits,
		feeReserveSats: policy.feeReserveSats,
		minimumBchFundingSats,
		minimumPusdFundingUnits: assetThreadPusdUnits
	};
}
