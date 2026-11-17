/**
 * Token identity (BCMR authchain) tracking.
 *
 * A CashToken category's identity starts at its authbase, the transaction whose
 * txid equals the category ID. The identity output is output 0 of the newest
 * transaction in the authchain: whoever spends output 0 hands the identity to
 * output 0 of the spending transaction. Wallets (Cashonize) treat that output
 * as "your identity" and refuse to sign transactions that move it away.
 *
 * PennyPicker therefore resolves the current identity output from chain data and
 * never spends it in ordinary transactions; only the dedicated separation
 * builder may spend it, and that builder returns it to the owner at output 0.
 */
import { binToHex, type TransactionCommon } from '@bitauth/libauth';

export interface AuthchainIo {
	/** Decoded transaction by txid (display byte order). */
	getTransaction(txid: string): Promise<TransactionCommon>;
	/** Txids in the history of the address/script that `lockingBytecode` pays. */
	getHistoryTxids(lockingBytecode: Uint8Array): Promise<string[]>;
	/** Whether `txid:0` is currently unspent. */
	isUnspent(txid: string, lockingBytecode: Uint8Array): Promise<boolean>;
}

export interface IdentityHead {
	category: string;
	/** Current identity output (always output index 0). */
	txid: string;
	vout: 0;
	lockingBytecodeHex: string;
	/** Authchain from the authbase to the head, in order. */
	chain: string[];
}

export const MAX_AUTHCHAIN_STEPS = 50;

export async function resolveIdentityHead(category: string, io: AuthchainIo): Promise<IdentityHead> {
	let txid = category;
	const chain: string[] = [];
	for (let step = 0; step < MAX_AUTHCHAIN_STEPS; step++) {
		const tx = await io.getTransaction(txid);
		chain.push(txid);
		const output0 = tx.outputs[0];
		if (!output0) throw new Error(`Authchain transaction ${txid.slice(0, 12)}… has no output 0.`);
		if (await io.isUnspent(txid, output0.lockingBytecode)) {
			return { category, txid, vout: 0, lockingBytecodeHex: binToHex(output0.lockingBytecode), chain };
		}
		let spender: string | undefined;
		for (const candidate of await io.getHistoryTxids(output0.lockingBytecode)) {
			if (candidate === txid) continue;
			const next = await io.getTransaction(candidate);
			if (next.inputs.some((input) => binToHex(input.outpointTransactionHash) === txid && input.outpointIndex === 0)) {
				spender = candidate;
				break;
			}
		}
		if (!spender) {
			throw new Error(`Cannot resolve the identity: ${txid.slice(0, 12)}…:0 is spent but its spender was not found.`);
		}
		txid = spender;
	}
	throw new Error('Authchain is longer than expected; refusing to guess the identity output.');
}

export const outpointKey = (txid: string, vout: number) => `${txid}:${vout}`;

/**
 * Flag wallet outputs that carry a token identity so ordinary builders skip them.
 * Fail closed: if a category's identity could not be resolved, every output at
 * index 0 (the only place an identity can live) is treated as protected.
 */
export function markIdentityOutputs<T extends { txid: string; vout: number; identityOf?: string }>(
	utxos: T[],
	heads: IdentityHead[],
	unresolvedCategories: string[] = []
): T[] {
	return utxos.map((utxo) => {
		const head = heads.find((candidate) => candidate.txid === utxo.txid && candidate.vout === utxo.vout);
		if (head) return { ...utxo, identityOf: head.category };
		if (utxo.vout === 0 && unresolvedCategories.length > 0) return { ...utxo, identityOf: unresolvedCategories[0] };
		const { identityOf: _drop, ...rest } = utxo;
		return rest as T;
	});
}
