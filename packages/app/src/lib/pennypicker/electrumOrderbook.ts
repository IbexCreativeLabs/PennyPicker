import {
	binToHex,
	decodeTransactionBch,
	hexToBin,
	hash256,
	sha256,
	swapEndianness,
	type TransactionBch
} from '@bitauth/libauth';
import { getAllMarketOrders } from '@unspent/catdex';
import { promiseAllInBatches } from '@unspent/tau';
import { indexBpsOrderUtxos, type OrderbookIndexResult, type ScriptUtxo } from './orderbookIndex';

/**
 * Query one reviewed PennyPicker covenant hash using CatDex's existing adapter,
 * then verify each reported UTXO against the raw transaction named by its outpoint.
 * Confirmed transactions also get a Merkle inclusion check against the returned
 * block header. This does not validate that header's chain of work or UTXO status.
 */
export async function loadBpsOrderbookFromElectrum(
	electrumClient: Parameters<typeof getAllMarketOrders>[0],
	queriedScriptHash: string,
	authCategory: string,
	assetCategory: string
): Promise<OrderbookIndexResult> {
	const results = await getAllMarketOrders(electrumClient, [queriedScriptHash]);
	const utxos = Array.from(results.values()) as ScriptUtxo[];
	await verifyUtxoTransactionOutputs(electrumClient, queriedScriptHash, utxos);
	return indexBpsOrderUtxos(
		queriedScriptHash,
		utxos,
		authCategory,
		assetCategory
	);
}

async function verifyUtxoTransactionOutputs(
	electrumClient: Parameters<typeof getAllMarketOrders>[0],
	queriedScriptHash: string,
	utxos: ScriptUtxo[]
): Promise<void> {
	const scriptHash = queriedScriptHash.toLowerCase();
	if (!/^[0-9a-f]{64}$/.test(scriptHash)) throw new Error('Covenant script hash must be 32-byte hex.');
	const txids = [...new Set(utxos.map((utxo) => utxo.tx_hash.toLowerCase()))];
	const rawTransactions: unknown[] = await promiseAllInBatches(
		async (txid: string) => {
			if (!/^[0-9a-f]{64}$/.test(txid)) {
				throw new Error('UTXO transaction ID must be 32-byte hex.');
			}
			return electrumClient.request('blockchain.transaction.get', txid, false);
		},
		txids
	);
	const transactions = rawTransactions.map((rawTransaction, index) => {
		const txid = txids[index]!;
		if (typeof rawTransaction !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(rawTransaction)) {
			throw new Error(`Electrum returned malformed raw transaction data for ${txid}.`);
		}
		const bytes = hexToBin(rawTransaction);
		const actualTxid = swapEndianness(binToHex(hash256(bytes))).toLowerCase();
		if (actualTxid !== txid) throw new Error(`Raw transaction hash mismatch for ${txid}.`);
		const transaction = decodeTransactionBch(bytes);
		if (typeof transaction === 'string') {
			throw new Error(`Could not decode raw transaction ${txid}: ${transaction}`);
		}
		return [txid, transaction] as const;
	});
	const byTxid = new Map(transactions);
	const confirmed = new Map<string, number>();
	for (const utxo of utxos) {
		const txid = utxo.tx_hash.toLowerCase();
		if (!Number.isSafeInteger(utxo.tx_pos) || utxo.tx_pos < 0) {
			throw new Error(`Electrum reported an invalid output index for ${txid}.`);
		}
		if (!Number.isSafeInteger(utxo.value) || utxo.value < 0) {
			throw new Error(`Electrum reported an invalid BCH value for ${txid}:${utxo.tx_pos}.`);
		}
		if (!Number.isSafeInteger(utxo.height) || utxo.height < -1) {
			throw new Error(`Electrum reported an invalid block height for ${txid}:${utxo.tx_pos}.`);
		}
		if (utxo.height > 0) {
			const knownHeight = confirmed.get(txid);
			if (knownHeight !== undefined && knownHeight !== utxo.height) {
				throw new Error(`Electrum reported inconsistent confirmation heights for ${txid}.`);
			}
			confirmed.set(txid, utxo.height);
		}
		const transaction = byTxid.get(txid);
		if (!transaction) throw new Error(`Raw transaction is missing for ${txid}.`);
		const output = transaction.outputs[utxo.tx_pos];
		if (!output) throw new Error(`Electrum reported a nonexistent output ${txid}:${utxo.tx_pos}.`);
		const actualScriptHash = swapEndianness(binToHex(sha256.hash(output.lockingBytecode))).toLowerCase();
		if (actualScriptHash !== scriptHash) {
			throw new Error(`Output ${txid}:${utxo.tx_pos} does not match the queried covenant script.`);
		}
		if (output.valueSatoshis !== BigInt(utxo.value)) {
			throw new Error(`Electrum's BCH value does not match raw output ${txid}:${utxo.tx_pos}.`);
		}
		verifyTokenData(utxo, output.token, txid);
	}
	await verifyConfirmedTransactionMerkleProofs(electrumClient, confirmed);
}

interface ElectrumMerkleProof {
	block_height: number;
	merkle: string[];
	pos: number;
}

async function verifyConfirmedTransactionMerkleProofs(
	electrumClient: Parameters<typeof getAllMarketOrders>[0],
	confirmed: Map<string, number>
): Promise<void> {
	const entries = [...confirmed.entries()];
	const proofs: unknown[] = await promiseAllInBatches(
		([txid, height]: [string, number]) =>
			electrumClient.request('blockchain.transaction.get_merkle', txid, height),
		entries
	);
	const parsed = proofs.map((proof, index) => {
		const [txid, requestedHeight] = entries[index]!;
		if (!isMerkleProof(proof) || proof.block_height !== requestedHeight) {
			throw new Error(`Electrum returned an invalid Merkle proof for ${txid}.`);
		}
		if (!proof.merkle.every((hash) => /^[0-9a-f]{64}$/i.test(hash))) {
			throw new Error(`Electrum returned an invalid Merkle branch for ${txid}.`);
		}
		return { txid, height: proof.block_height, proof };
	});
	const heights = [...new Set(parsed.map(({ height }) => height))];
	const headers = await Promise.all(
		heights.map(async (height) => {
			const response: unknown = await electrumClient.request('blockchain.header.get', height);
			const header =
				typeof response === 'string'
					? response
					: typeof response === 'object' && response !== null && 'hex' in response
						? response.hex
						: undefined;
			const responseHeight =
				typeof response === 'object' && response !== null && 'height' in response
					? response.height
					: height;
			if (
				typeof header !== 'string' ||
				!/^[0-9a-f]{160}$/i.test(header) ||
				responseHeight !== height
			) {
				throw new Error(`Electrum returned a malformed block header at height ${height}.`);
			}
			return [height, header] as const;
		})
	);
	const merkleRoots = new Map(
		headers.map(([height, header]) => [
			height,
			binToHex(hexToBin(header.slice(72, 136)).reverse()).toLowerCase()
		])
	);
	for (const { txid, height, proof } of parsed) {
		const expectedRoot = merkleRoots.get(height);
		if (!expectedRoot || calculateMerkleRoot(txid, proof.merkle, proof.pos) !== expectedRoot) {
			throw new Error(`Electrum's Merkle proof does not match block ${height} for ${txid}.`);
		}
	}
}

function isMerkleProof(value: unknown): value is ElectrumMerkleProof {
	if (typeof value !== 'object' || value === null) return false;
	const proof = value as Partial<ElectrumMerkleProof>;
	return (
		Number.isSafeInteger(proof.block_height) &&
		Array.isArray(proof.merkle) &&
		Number.isSafeInteger(proof.pos) &&
		(proof.pos as number) >= 0
	);
}

/** Hash a displayed txid and Electrum branch (display byte order) to the header root. */
export function calculateMerkleRoot(txid: string, branch: string[], position: number): string {
	if (!/^[0-9a-f]{64}$/i.test(txid) || !Number.isSafeInteger(position) || position < 0) {
		throw new Error('Invalid transaction ID or Merkle position.');
	}
	let current = hexToBin(txid).reverse();
	for (const siblingHex of branch) {
		if (!/^[0-9a-f]{64}$/i.test(siblingHex)) throw new Error('Invalid Merkle branch hash.');
		const sibling = hexToBin(siblingHex).reverse();
		const pair = new Uint8Array(64);
		if ((position & 1) === 0) {
			pair.set(current, 0);
			pair.set(sibling, 32);
		} else {
			pair.set(sibling, 0);
			pair.set(current, 32);
		}
		current = hash256(pair);
		position = Math.floor(position / 2);
	}
	if (position !== 0) throw new Error('Merkle branch is too short for the reported position.');
	return binToHex(current.reverse()).toLowerCase();
}

function verifyTokenData(
	utxo: ScriptUtxo,
	actual: TransactionBch['outputs'][number]['token'],
	txid: string
): void {
	const reported = utxo.token_data;
	if (!reported && !actual) return;
	if (!reported || !actual) throw new Error(`Electrum token metadata mismatch for ${txid}:${utxo.tx_pos}.`);
	const reportedAmount = parseTokenAmount(reported.amount, txid, utxo.tx_pos);
	if (
		binToHex(actual.category).toLowerCase() !== reported.category.toLowerCase() ||
		actual.amount !== reportedAmount
	) {
		throw new Error(`Electrum token category or amount mismatch for ${txid}:${utxo.tx_pos}.`);
	}
	if (!reported.nft && !actual.nft) return;
	if (!reported.nft || !actual.nft) throw new Error(`Electrum NFT metadata mismatch for ${txid}:${utxo.tx_pos}.`);
	if (
		actual.nft.capability !== reported.nft.capability ||
		binToHex(actual.nft.commitment).toLowerCase() !== reported.nft.commitment.toLowerCase()
	) {
		throw new Error(`Electrum NFT commitment mismatch for ${txid}:${utxo.tx_pos}.`);
	}
}

function parseTokenAmount(amount: string | number | bigint, txid: string, vout: number): bigint {
	if (typeof amount === 'bigint') return amount;
	if (typeof amount === 'number') {
		if (!Number.isSafeInteger(amount) || amount < 0) {
			throw new Error(`Electrum returned an imprecise token amount for ${txid}:${vout}.`);
		}
		return BigInt(amount);
	}
	if (!/^(0|[1-9][0-9]*)$/.test(amount)) {
		throw new Error(`Electrum returned an invalid token amount for ${txid}:${vout}.`);
	}
	return BigInt(amount);
}
