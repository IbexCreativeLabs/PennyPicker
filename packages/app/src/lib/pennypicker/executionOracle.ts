import { assertFreshOracle, rateAtDeltaBps, type OracleObservation } from './market';
import type { ProductionBchPusdOracleProvider } from './oracle';

const verifiedOracleBrand: unique symbol = Symbol('verified-bch-pusd-oracle');

/** An oracle observation that passed freshness and provider authenticity checks. */
export type VerifiedExecutionOracle = OracleObservation & {
	assetCategory: string;
	readonly [verifiedOracleBrand]: true;
};

/**
 * Fetch and authenticate an execution quote. Development providers, stale or
 * malformed observations, and unverifiable data fail closed.
 */
export async function getVerifiedExecutionOracle(
	provider: ProductionBchPusdOracleProvider,
	expectedAssetCategory: string
): Promise<VerifiedExecutionOracle> {
	if (provider.confidence !== 'production') {
		throw new Error('Transaction preparation requires a production BCH/PUSD oracle.');
	}
	const expectedCategory = normalizeCategory(expectedAssetCategory, 'Expected PUSD category');
	const providerCategory = normalizeCategory(provider.assetCategory, 'Oracle provider category');
	if (providerCategory !== expectedCategory) {
		throw new Error('The oracle provider is configured for a different PUSD token category.');
	}
	const observation = await provider.getLatest();
	assertFreshOracle(observation);
	if (observation.confidence !== 'production') {
		throw new Error('The oracle observation is not marked as production data.');
	}
	if (observation.source !== provider.sourceName) {
		throw new Error('The oracle observation source does not match its provider.');
	}
	const observationCategory = normalizeCategory(
		observation.assetCategory ?? '',
		'Oracle observation category'
	);
	if (observationCategory !== expectedCategory) {
		throw new Error('The BCH/PUSD quote is for a different token category.');
	}
	if (!(await provider.validateObservation(observation))) {
		throw new Error('The BCH/PUSD oracle observation could not be authenticated.');
	}
	// Validation may be asynchronous; check freshness again at the handoff boundary.
	assertFreshOracle(observation);
	return Object.freeze({
		...observation,
		assetCategory: observationCategory,
		[verifiedOracleBrand]: true as const
	});
}

/** Enforce the exact configured asset category at each execution handoff. */
export function assertVerifiedOracleCategory(
	observation: VerifiedExecutionOracle,
	expectedAssetCategory: string
): string {
	if (observation[verifiedOracleBrand] !== true) {
		throw new Error('The BCH/PUSD quote has not passed the execution-oracle verification boundary.');
	}
	const expected = normalizeCategory(expectedAssetCategory, 'Expected PUSD category');
	const observed = normalizeCategory(observation.assetCategory, 'Oracle provider category');
	if (observed !== expected) {
		throw new Error('The BCH/PUSD quote is for a different token category.');
	}
	return observed;
}

function normalizeCategory(category: string, label: string): string {
	if (typeof category !== 'string') throw new Error(`${label} must be 32-byte hex.`);
	const normalized = category.toLowerCase();
	if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error(`${label} must be 32-byte hex.`);
	return normalized;
}

/** Derive the exact fixed-point limit rate used by a transaction builder. */
export function executionLimitRate(
	observation: VerifiedExecutionOracle,
	deltaBps: number,
	expectedAssetCategory: string
): bigint {
	assertVerifiedOracleCategory(observation, expectedAssetCategory);
	assertFreshOracle(observation);
	return rateAtDeltaBps(observation.rateSatsPerPusdScaled, deltaBps);
}
