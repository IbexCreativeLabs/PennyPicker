import type { OracleObservation } from './market';

export interface BchPusdOracleProvider {
	readonly sourceName: string;
	readonly confidence: OracleObservation['confidence'];
	getLatest(): Promise<OracleObservation>;
}

/** A development-only arithmetic fixture; it is not a BCH/PUSD market price. */
export class DevelopmentMockOracle implements BchPusdOracleProvider {
	readonly sourceName = 'Development mock — not market data';
	readonly confidence = 'development' as const;

	async getLatest(): Promise<OracleObservation> {
		return {
			pair: 'BCH/PUSD',
			// Deliberately simple fixture: 0.5 BCH per PUSD. This makes no peg claim.
			rateSatsPerPusdScaled: 50_000_000n * 100_000_000n,
			observedAtMs: Date.now(),
			source: this.sourceName,
			confidence: this.confidence
		};
	}
}

/** Production integrations must implement freshness and authenticity at the adapter boundary. */
export interface ProductionOracleRequirements {
	/** Feed-specific signature, quorum, or trusted transport validation. */
	validateObservation(observation: OracleObservation): Promise<boolean>;
}
