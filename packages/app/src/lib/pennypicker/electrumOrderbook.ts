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
 * The server's unspent status and claimed block height are not proven here.
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
	for (const utxo of utxos) {
		const txid = utxo.tx_hash.toLowerCase();
		if (!Number.isSafeInteger(utxo.tx_pos) || utxo.tx_pos < 0) {
			throw new Error(`Electrum reported an invalid output index for ${txid}.`);
		}
		if (!Number.isSafeInteger(utxo.value) || utxo.value < 0) {
			throw new Error(`Electrum reported an invalid BCH value for ${txid}:${utxo.tx_pos}.`);
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
