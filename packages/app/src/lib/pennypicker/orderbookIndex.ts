import { decodeBpsOrderCommitment, type BpsOrderCommitment } from './orderCommitment';
import { MAX_BCH_SATOSHIS } from './market';

/** Electrum-style UTXO response for an explicitly queried covenant script hash. */
export interface ScriptUtxo {
	tx_hash: string;
	tx_pos: number;
	height: number;
	value: number;
	token_data?: {
		category: string;
		amount: string | number | bigint;
		nft?: {
			capability: string;
			commitment: string;
		};
	};
}

export interface IndexedBpsOrder {
	scriptHash: string;
	txid: string;
	vout: number;
	assetVout: number;
	height: number;
	confirmation: 'confirmed' | 'mempool';
	commitment: BpsOrderCommitment;
	orderEscrowSatoshis: bigint;
	assetEscrowUnits: bigint;
	assetEscrowSatoshis: bigint;
	status: 'open' | 'filled';
}

export interface OrderbookIndexResult {
	scriptHash: string;
	orders: IndexedBpsOrder[];
	ignored: Array<{ outpoint: string; reason: string }>;
}

function normalizeCategory(category: string): string {
	const normalized = category.toLowerCase();
	if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error('Token category must be 32-byte hex.');
	return normalized;
}

function normalizeTxid(txid: string): string {
	const normalized = txid.toLowerCase();
	if (!/^[0-9a-f]{64}$/.test(normalized))
		throw new Error('UTXO transaction ID must be 32-byte hex.');
	return normalized;
}

function tokenAmount(utxo: ScriptUtxo): bigint {
	const amount = utxo.token_data ? BigInt(utxo.token_data.amount) : 0n;
	if (amount < 0n || amount > (1n << 63n) - 1n)
		throw new Error('CashToken amount is out of range.');
	return amount;
}

/**
 * Index live order/asset-thread pairs from UTXOs returned for one covenant hash.
 * This validates structure and token categories; it does not prove the source
 * query was truthful or validate a spending covenant. Callers must query the
 * hash derived from the reviewed PennyPicker script.
 */
export function indexBpsOrderUtxos(
	queriedScriptHash: string,
	utxos: ScriptUtxo[],
	authCategory: string,
	assetCategory: string
): OrderbookIndexResult {
	if (!/^[0-9a-f]{64}$/i.test(queriedScriptHash)) {
		throw new Error('Covenant script hash must be 32-byte hex.');
	}
	const auth = normalizeCategory(authCategory);
	const asset = normalizeCategory(assetCategory);
	const scriptHash = queriedScriptHash.toLowerCase();
	const byOutpoint = new Map<string, ScriptUtxo>();
	for (const utxo of utxos) {
		const txid = normalizeTxid(utxo.tx_hash);
		if (!Number.isSafeInteger(utxo.tx_pos) || utxo.tx_pos < 0) {
			throw new Error(`UTXO ${txid} has an invalid output index.`);
		}
		if (!Number.isSafeInteger(utxo.height) || utxo.height < -1) {
			throw new Error(`UTXO ${txid}:${utxo.tx_pos} has an invalid block height.`);
		}
		if (
			!Number.isSafeInteger(utxo.value) ||
			utxo.value < 0 ||
			BigInt(utxo.value) > MAX_BCH_SATOSHIS
		) {
			throw new Error(`UTXO ${txid}:${utxo.tx_pos} has an invalid BCH value.`);
		}
		const outpoint = `${txid}:${utxo.tx_pos}`;
		if (byOutpoint.has(outpoint)) throw new Error(`Duplicate UTXO returned for ${outpoint}.`);
		byOutpoint.set(outpoint, utxo);
	}

	const orders: IndexedBpsOrder[] = [];
	const ignored: OrderbookIndexResult['ignored'] = [];
	for (const utxo of utxos) {
		if (utxo.token_data?.category.toLowerCase() !== auth || !utxo.token_data.nft) continue;
		const outpoint = `${utxo.tx_hash.toLowerCase()}:${utxo.tx_pos}`;
		if (utxo.tx_pos % 2 !== 0) {
			ignored.push({ outpoint, reason: 'Order thread is not at an even output index.' });
			continue;
		}
		if (utxo.token_data.nft.capability !== 'mutable') {
			ignored.push({ outpoint, reason: 'Order NFT is not mutable.' });
			continue;
		}
		let orderTokenAmount: bigint;
		try {
			orderTokenAmount = tokenAmount(utxo);
		} catch (cause) {
			ignored.push({
				outpoint,
				reason: cause instanceof Error ? cause.message : String(cause)
			});
			continue;
		}
		if (orderTokenAmount !== 0n) {
			ignored.push({ outpoint, reason: 'Order authorization NFT must not carry fungible tokens.' });
			continue;
		}
		let commitment: BpsOrderCommitment;
		try {
			commitment = decodeBpsOrderCommitment(hexToBytes(utxo.token_data.nft.commitment));
		} catch (cause) {
			ignored.push({
				outpoint,
				reason: cause instanceof Error ? cause.message : String(cause)
			});
			continue;
		}
		const assetThread = byOutpoint.get(`${utxo.tx_hash.toLowerCase()}:${utxo.tx_pos + 1}`);
		if (!assetThread) {
			ignored.push({ outpoint, reason: 'The paired asset thread is missing or already spent.' });
			continue;
		}
		if (assetThread.height !== utxo.height) {
			ignored.push({
				outpoint,
				reason: 'Order and asset threads have inconsistent confirmation heights.'
			});
			continue;
		}
		const assetToken = assetThread.token_data;
		if (assetToken && assetToken.category.toLowerCase() !== asset) {
			ignored.push({ outpoint, reason: 'The paired thread contains a different token category.' });
			continue;
		}
		if (assetToken?.nft) {
			ignored.push({ outpoint, reason: 'The paired asset thread unexpectedly contains an NFT.' });
			continue;
		}
		let assetEscrowUnits: bigint;
		try {
			assetEscrowUnits = tokenAmount(assetThread);
		} catch (cause) {
			ignored.push({
				outpoint,
				reason: cause instanceof Error ? cause.message : String(cause)
			});
			continue;
		}
		if (commitment.side === 'sell-pusd' && assetEscrowUnits !== commitment.remainingUnits) {
			ignored.push({
				outpoint,
				reason: 'Sell order token escrow does not equal its remaining quantity.'
			});
			continue;
		}
		orders.push({
			scriptHash,
			txid: utxo.tx_hash.toLowerCase(),
			vout: utxo.tx_pos,
			assetVout: assetThread.tx_pos,
			height: utxo.height,
			confirmation: utxo.height > 0 ? 'confirmed' : 'mempool',
			commitment,
			orderEscrowSatoshis: BigInt(utxo.value),
			assetEscrowUnits,
			assetEscrowSatoshis: BigInt(assetThread.value),
			status: commitment.remainingUnits === 0n ? 'filled' : 'open'
		});
	}
	return { scriptHash, orders, ignored };
}

function hexToBytes(hex: string): Uint8Array {
	if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
		throw new Error('Order commitment must be even-length hex.');
	}
	const result = new Uint8Array(hex.length / 2);
	for (let index = 0; index < result.length; index++) {
		result[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
	}
	return result;
}
