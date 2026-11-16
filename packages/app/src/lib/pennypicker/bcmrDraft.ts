import { binToHex, sha256 } from '@bitauth/libauth';

export const CHIPNET_SPLIT_ID =
	'00000000040ba9641ba98a37b2e5ceead38e4e2930ac8f145c8094f94c708727';

export interface PusdBcmrDraft {
	category: string;
	json: string;
	sha256Hex: string;
}

/**
 * Build a local BCMR-v2 import draft for an already verified PUSD category.
 * This does not publish or authenticate a registry. The embedded registry
 * identity is intentionally off-chain and is not an invented authbase.
 */
export function createPusdBcmrDraft(category: string, revision = new Date()): PusdBcmrDraft {
	const normalizedCategory = category.toLowerCase();
	if (!/^[0-9a-f]{64}$/.test(normalizedCategory)) {
		throw new Error('PUSD category must be a verified 32-byte transaction ID.');
	}
	if (!Number.isFinite(revision.getTime())) throw new Error('BCMR revision time is invalid.');

	const timestamp = revision.toISOString();
	const registry = {
		$schema: 'https://cashtokens.org/bcmr-v2.schema.json',
		defaultChain: CHIPNET_SPLIT_ID,
		version: { major: 0, minor: 1, patch: 0 },
		latestRevision: timestamp,
		registryIdentity: {
			name: 'PennyPicker Experimental Chipnet Token Registry',
			description:
				'An experimental Chipnet metadata draft. PUSD is not USD-backed and has no guaranteed peg.'
		},
		identities: {
			[normalizedCategory]: {
				[timestamp]: {
					name: 'PennyPicker USD',
					description:
						'Experimental fixed-supply Chipnet token. Not USD-backed and has no guaranteed USD peg.',
					token: {
						category: normalizedCategory,
						symbol: 'PUSD',
						decimals: 2
					}
				}
			}
		}
	};
	const json = `${JSON.stringify(registry, null, 2)}\n`;
	const sha256Hex = binToHex(sha256.hash(new TextEncoder().encode(json)));
	return { category: normalizedCategory, json, sha256Hex };
}
