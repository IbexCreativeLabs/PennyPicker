import { assertFreshOracle, rateAtDeltaBps, type OracleObservation } from './market';
import type { ProductionBchPusdOracleProvider } from './oracle';

const verifiedOracleBrand: unique symbol = Symbol('verified-bch-pusd-oracle');

/** An oracle observation that passed freshness and provider authenticity checks. */
export type VerifiedExecutionOracle = OracleObservation & {
	readonly [verifiedOracleBrand]: true;
};

/**
 * Fetch and authenticate an execution quote. Development providers, stale or
 * malformed observations, and unverifiable data fail closed.
 */
export async function getVerifiedExecutionOracle(
	provider: ProductionBchPusdOracleProvider
): Promise<VerifiedExecutionOracle> {
	if (provider.confidence !== 'production') {
		throw new Error('Transaction preparation requires a production BCH/PUSD oracle.');
	}
	const observation = await provider.getLatest();
	assertFreshOracle(observation);
	if (observation.confidence !== 'production') {
		throw new Error('The oracle observation is not marked as production data.');
	}
	if (observation.source !== provider.sourceName) {
		throw new Error('The oracle observation source does not match its provider.');
	}
	if (!(await provider.validateObservation(observation))) {
		throw new Error('The BCH/PUSD oracle observation could not be authenticated.');
	}
	// Validation may be asynchronous; check freshness again at the handoff boundary.
	assertFreshOracle(observation);
	return Object.freeze({ ...observation, [verifiedOracleBrand]: true as const });
}

/** Derive the exact fixed-point limit rate used by a transaction builder. */
export function executionLimitRate(observation: VerifiedExecutionOracle, deltaBps: number): bigint {
	assertFreshOracle(observation);
	return rateAtDeltaBps(observation.rateSatsPerPusdScaled, deltaBps);
}
