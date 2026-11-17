/**
 * Authchain resolution and identity marking (pure, mocked chain data).
 * Run: pnpm dlx tsx scripts/pennypicker-identity.test.ts   (from packages/app)
 */
import { binToHex, hexToBin, type TransactionCommon } from '@bitauth/libauth';
import { markIdentityOutputs, resolveIdentityHead, type AuthchainIo } from '../src/lib/pennypicker/identity';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
	if (!ok) failures++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const W = hexToBin('76a914' + '22'.repeat(20) + '88ac');
const id = (n: number) => n.toString(16).padStart(2, '0').repeat(32);
const tx = (spends: [string, number][]): TransactionCommon => ({
	version: 2, locktime: 0,
	inputs: spends.map(([t, i]) => ({ outpointTransactionHash: hexToBin(t), outpointIndex: i, sequenceNumber: 0, unlockingBytecode: new Uint8Array() })),
	outputs: [{ lockingBytecode: W, valueSatoshis: 1000n }, { lockingBytecode: W, valueSatoshis: 5000n }]
});
function io(txs: Record<string, TransactionCommon>, unspent: string[], hideFromHistory: string[] = []): AuthchainIo {
	return {
		async getTransaction(t) { const x = txs[t]; if (!x) throw new Error('no tx'); return x; },
		async getHistoryTxids(lb) { return binToHex(lb) === binToHex(W) ? Object.keys(txs).filter((t) => !hideFromHistory.includes(t)) : []; },
		async isUnspent(t) { return unspent.includes(`${t}:0`); }
	};
}
const A = id(1), B = id(2), C = id(3), D = id(4);

// Chipnet shape: authbase A → genesis B (spends A:0); B:0 unspent.
// D spends A:1 and is listed before B in the history, so it must be skipped.
const chipnetLike = { [A]: tx([[id(9), 0]]), [D]: tx([[A, 1]]), [B]: tx([[A, 0]]) };
const h1 = await resolveIdentityHead(A, io(chipnetLike, [`${B}:0`]));
check('head is the genesis output 0', h1.txid === B && h1.vout === 0, h1.txid.slice(0, 4));
check('authchain recorded in order', h1.chain.join() === [A, B].join());
check('a transaction spending A:1 (listed first) is not taken as the spender', !h1.chain.includes(D));

const longer = { ...chipnetLike, [C]: tx([[B, 0]]) };
const h2 = await resolveIdentityHead(A, io(longer, [`${C}:0`]));
check('follows a longer chain to its head', h2.txid === C && h2.chain.length === 3);

const h3 = await resolveIdentityHead(A, io({ [A]: tx([[id(9), 0]]) }, [`${A}:0`]));
check('unspent authbase is its own head', h3.txid === A && h3.chain.length === 1);

let threw = '';
try { await resolveIdentityHead(A, io(longer, [], [C])); } catch (e) { threw = String(e); }
check('spent head with an unknown spender fails instead of guessing', threw.includes('spender was not found'));

// Marking.
const utxos = [
	{ txid: B, vout: 0 },
	{ txid: C, vout: 0, identityOf: 'stale' },
	{ txid: D, vout: 1 }
];
const marked = markIdentityOutputs(utxos, [h1]);
check('marks exactly the head', marked[0]!.identityOf === A && !marked[1]!.identityOf && !marked[2]!.identityOf);
const closed = markIdentityOutputs(utxos, [], [A]);
check('fails closed: every output-0 coin held back when unresolved', !!closed[0]!.identityOf && !!closed[1]!.identityOf && !closed[2]!.identityOf);

console.log(failures === 0 ? '\nAll identity checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
