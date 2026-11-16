/**
 * End-to-end builder tests: build PennyPicker transactions with the real
 * builders, sign wallet/placeholder inputs with throwaway keys, and verify each
 * transaction in libauth's BCH 2025 VM, chaining outputs between steps.
 * Run: pnpm dlx tsx scripts/pennypicker-exchange.test.ts   (from packages/app)
 */
import {
	binToHex,
	createVirtualMachineBch2025,
	encodeDataPush,
	encodeTransaction,
	generateSigningSerializationBch,
	hash256,
	hashTransaction,
	hexToBin,
	lockingBytecodeToCashAddress,
	secp256k1,
	SigningSerializationFlag,
	type TransactionCommon
} from '@bitauth/libauth';
import { makerPkhFromPublicKey, oracleContract, orderContract, encodeOracleCommitment } from '../src/lib/pennypicker/contracts';
import {
	buildCancelOrder,
	buildCreateOrder,
	buildFillOrders,
	buildOracleGenesis,
	buildOracleUpdate,
	buildPusdTransfer,
	describeOrder,
	findOracleUtxo,
	lockingBytecodeToChipnetAddress,
	orderParams,
	p2pkhLockingBytecode,
	parseAnnouncement,
	toOpenOrder,
	type ChainUtxo,
	type MarketConfig,
	type UnsignedExchangeTransaction
} from '../src/lib/pennypicker/exchange';

import { describeBroadcastError, describeSignError } from '../src/lib/pennypicker/ui/txErrors';

const vm = createVirtualMachineBch2025(false);
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
	if (!ok) failures++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const key = (byte: string) => {
	const priv = hexToBin(byte.repeat(32));
	const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
	const pkh = makerPkhFromPublicKey(pub);
	return { priv, pub, pkh, address: lockingBytecodeToChipnetAddress(p2pkhLockingBytecode(pkh)), locking: p2pkhLockingBytecode(pkh) };
};
const operator = key('0a');
const maker = key('0b');
const taker = key('0c');

/** Simulate Cashonize: sign empty P2PKH inputs and replace contract placeholders. */
function sign(unsigned: UnsignedExchangeTransaction, signer: ReturnType<typeof key>): TransactionCommon {
	const tx: TransactionCommon = structuredClone(unsigned.transaction);
	const sources = unsigned.sourceOutputs.map(({ outpointIndex: _a, outpointTransactionHash: _b, sequenceNumber: _c, unlockingBytecode: _d, contract: _e, ...output }) => output);
	const flags = SigningSerializationFlag.allOutputs | SigningSerializationFlag.utxos | SigningSerializationFlag.forkId;
	const sigFor = (index: number, covered: Uint8Array) => {
		const preimage = generateSigningSerializationBch(
			{ inputIndex: index, sourceOutputs: sources, transaction: tx },
			{ coveredBytecode: covered, signingSerializationType: Uint8Array.of(flags) }
		);
		return Uint8Array.from([...(secp256k1.signMessageHashSchnorr(signer.priv, hash256(preimage)) as Uint8Array), flags]);
	};
	unsigned.sourceOutputs.forEach((entry, index) => {
		const input = tx.inputs[index]!;
		if (!entry.contract) {
			if (binToHex(entry.lockingBytecode) !== binToHex(signer.locking)) throw new Error(`input ${index} not owned by signer`);
			input.unlockingBytecode = Uint8Array.from([...encodeDataPush(sigFor(index, entry.lockingBytecode)), ...encodeDataPush(signer.pub)]);
		}
	});
	return tx;
}

function verify(name: string, unsigned: UnsignedExchangeTransaction, signer: ReturnType<typeof key>) {
	const tx = sign(unsigned, signer);
	const sources = unsigned.sourceOutputs.map(({ outpointIndex: _a, outpointTransactionHash: _b, sequenceNumber: _c, unlockingBytecode: _d, contract: _e, ...output }) => output);
	const result = vm.verify({ transaction: tx, sourceOutputs: sources });
	const bytes = encodeTransaction(tx);
	const inValue = sources.reduce((s, o) => s + o.valueSatoshis, 0n);
	const outValue = tx.outputs.reduce((s, o) => s + o.valueSatoshis, 0n);
	check(name, result === true, result === true ? `${bytes.length} bytes, fee ${inValue - outValue} sats (${Number(inValue - outValue) / bytes.length} sat/B)` : String(result));
	return { tx, txid: hashTransaction(bytes) };
}

/** UTXOs a transaction creates for a given locking bytecode. */
function outputsTo(txid: string, tx: TransactionCommon, locking: Uint8Array): ChainUtxo[] {
	return tx.outputs.flatMap((output, vout) =>
		binToHex(output.lockingBytecode) === binToHex(locking)
			? [{
					txid, vout, satoshis: output.valueSatoshis, height: 1,
					...(output.token ? { token: { category: binToHex(output.token.category), amount: output.token.amount, ...(output.token.nft ? { nft: { capability: output.token.nft.capability, commitment: binToHex(output.token.nft.commitment) } } : {}) } } : {})
				}]
			: []
	);
}

const PUSD = 'ab'.repeat(32);
const fund = (owner: ReturnType<typeof key>, seed: number, sats: bigint, pusd?: bigint): ChainUtxo => ({
	txid: binToHex(hash256(Uint8Array.of(seed))), vout: 0, satoshis: sats, height: 1,
	...(pusd ? { token: { category: PUSD, amount: pusd } } : {})
});

// 1. Oracle genesis at 500.00 PUSD per BCH.
const RATE = 500n * 100_000_000n;
let operatorUtxos = [fund(operator, 1, 1_000_000n)];
{
	let threw = false;
	try { buildOracleGenesis(operator.address, operator.pkh, [{ ...operatorUtxos[0]!, height: 0 }], { price: RATE, timestamp: 1_800_000_000, sequence: 1 }); } catch { threw = true; }
	check('oracle genesis refuses an unconfirmed vout 0', threw);
}
const genesis = buildOracleGenesis(operator.address, operator.pkh, [...operatorUtxos, fund(operator, 99, 5_000n, 7n)], { price: RATE, timestamp: 1_800_000_000, sequence: 1 });
const g = verify('oracle genesis', genesis, operator);
check('oracle genesis spends only the vout-0 input', genesis.transaction.inputs.length === 1);
const market: MarketConfig = { pusdCategory: PUSD, oracleCategory: genesis.createdCategory!, oracleOperatorPkh: operator.pkh };
const oracleLocking = oracleContract({ operatorPkh: operator.pkh }).lockingBytecode;
let oracle = findOracleUtxo(outputsTo(g.txid, g.tx, oracleLocking), market)!;
check('oracle found after genesis', !!oracle && oracle.state.sequence === 1 && oracle.state.price === RATE);
operatorUtxos = outputsTo(g.txid, g.tx, operator.locking);

// 2. Oracle update to 520.00.
const upd = buildOracleUpdate(market, oracle, operator.address, operatorUtxos, { price: 520n * 100_000_000n, timestamp: 1_800_000_060, sequence: 2 });
const u = verify('oracle update authorised by operator input', upd, operator);
oracle = findOracleUtxo(outputsTo(u.txid, u.tx, oracleLocking), market)!;
const price = oracle.state.price;
{
	let threw = false;
	try { buildOracleUpdate(market, oracle, maker.address, [fund(maker, 9, 100_000n)], { ...oracle.state, sequence: 3 }); } catch { threw = true; }
	check('non-operator cannot build an oracle update', threw);
}

// 3. Maker posts an ask: sell 0.1 BCH at +50 BPS.
let makerUtxos = [fund(maker, 2, 20_000_000n), fund(maker, 3, 1_000n, 10_000n)];
const createAsk = buildCreateOrder(market, oracle, maker.address, maker.pkh, makerUtxos, { side: 'ask', deltaBps: 50, amount: 10_000_000n });
const ca = verify('create ask (sell BCH)', createAsk, maker);
oracle = findOracleUtxo(outputsTo(ca.txid, ca.tx, oracleLocking), market)!;
const announced = ca.tx.outputs.map((o) => parseAnnouncement(o.lockingBytecode)).find(Boolean);
check('announcement parses and re-derives the same contract', !!announced && describeOrder(market, announced).lockingBytecodeHex === createAsk.order!.lockingBytecodeHex);
const spent = (tx: TransactionCommon, u: ChainUtxo) => tx.inputs.some((i) => binToHex(i.outpointTransactionHash) === u.txid && i.outpointIndex === u.vout);
makerUtxos = [...makerUtxos.filter((u) => !spent(ca.tx, u)), ...outputsTo(ca.txid, ca.tx, maker.locking)];
let askOrder = toOpenOrder(createAsk.order!, outputsTo(ca.txid, ca.tx, hexToBin(createAsk.order!.lockingBytecodeHex))[0]!, market)!;
check('ask has 0.1 BCH available', askOrder.availableSats === 10_000_000n);

// 4. Maker posts a bid: buy BCH with 60.00 PUSD at -40 BPS.
{
	let threw = false;
	try { buildCreateOrder(market, oracle, maker.address, maker.pkh, makerUtxos, { side: 'bid', deltaBps: -40, amount: 1_000_000n }); } catch { threw = true; }
	check('bid creation refuses insufficient PUSD', threw);
	threw = false;
	try { buildCreateOrder(market, oracle, maker.address, maker.pkh, makerUtxos, { side: 'ask', deltaBps: -1, amount: 10_000_000n }); } catch { threw = true; }
	check('ask below the reference is rejected', threw);
}
const createBid = buildCreateOrder(market, oracle, maker.address, maker.pkh, makerUtxos, { side: 'bid', deltaBps: -40, amount: 6_000n });
const cb = verify('create bid (buy BCH)', createBid, maker);
oracle = findOracleUtxo(outputsTo(cb.txid, cb.tx, oracleLocking), market)!;
let bidOrder = toOpenOrder(createBid.order!, outputsTo(cb.txid, cb.tx, hexToBin(createBid.order!.lockingBytecodeHex))[0]!, market)!;
check('bid holds 60.00 PUSD', bidOrder.availableUnits === 6_000n);

// 5. Taker buys 0.03 BCH from the ask (pays PUSD).
const takerUtxos = [fund(taker, 5, 50_000_000n), fund(taker, 6, 1_000n, 50_000n)];
const fill1 = buildFillOrders(market, oracle, taker.address, takerUtxos, [{ order: askOrder, sats: 3_000_000n }]);
const f1 = verify('taker buys BCH from ask', fill1, taker);
oracle = findOracleUtxo(outputsTo(f1.txid, f1.tx, oracleLocking), market)!;
askOrder = toOpenOrder(askOrder, outputsTo(f1.txid, f1.tx, hexToBin(askOrder.lockingBytecodeHex))[0]!, market)!;
// 0.03 BCH × 520 × 1.005 = 15.678 → 15.68 PUSD (rounded up for the maker)
check('ask received 15.68 PUSD and has 0.07 BCH left', askOrder.heldUnits === 1_568n && askOrder.availableSats === 7_000_000n, `held ${askOrder.heldUnits}, avail ${askOrder.availableSats}`);

// 6. Taker sells 0.05 BCH to the bid (receives PUSD).
const takerAfter = [...takerUtxos.filter((u) => !spent(f1.tx, u)), ...outputsTo(f1.txid, f1.tx, taker.locking)];
const fill2 = buildFillOrders(market, oracle, taker.address, takerAfter, [{ order: bidOrder, sats: 5_000_000n }]);
const f2 = verify('taker sells BCH to bid', fill2, taker);
bidOrder = toOpenOrder(bidOrder, outputsTo(f2.txid, f2.tx, hexToBin(bidOrder.lockingBytecodeHex))[0]!, market)!;
// 0.05 × 520 × 0.996 = 25.896 → 25.89 PUSD (rounded down for the maker)
check('bid paid 25.89 PUSD for 0.05 BCH', bidOrder.availableUnits === 6_000n - 2_589n && bidOrder.proceeds === 5_000_000n, `left ${bidOrder.availableUnits}`);
{
	let threw = false;
	try { buildFillOrders(market, oracle, taker.address, takerAfter, [{ order: bidOrder, sats: 20_000_000n }]); } catch { threw = true; }
	check('cannot sell more BCH than the bid can pay for', threw);
}

// 7. Maker cancels the partially filled ask (authorised by maker input).
const cancel = buildCancelOrder(market, askOrder, maker.address, outputsTo(cb.txid, cb.tx, maker.locking));
verify('maker cancels ask and withdraws BCH + PUSD proceeds', cancel, maker);
{
	let threw = false;
	try { buildCancelOrder(market, askOrder, taker.address, takerUtxos); } catch { threw = true; }
	check('non-maker cannot build cancel', threw);
}
// 8. PUSD transfer to teammates (token-aware and plain addresses).
{
	const sender = key('0d');
	const genesisReady = fund(sender, 40, 500_000n);
	const senderUtxos = [genesisReady, fund(sender, 41, 1_000n, 100_000n), fund(sender, 42, 20_000n)];
	const zAddr = lockingBytecodeToChipnetAddress(maker.locking, true);
	const send = buildPusdTransfer(PUSD, sender.address, senderUtxos, [{ address: zAddr, units: 2_500n }, { address: taker.address, units: 1_000n }], [`${genesisReady.txid}:0`]);
	const s1 = verify('send PUSD to two teammates', send, sender);
	const toMaker = outputsTo(s1.txid, s1.tx, maker.locking)[0];
	const change = outputsTo(s1.txid, s1.tx, sender.locking).find((u) => u.token);
	check('recipients and change get the right PUSD', toMaker?.token?.amount === 2_500n && outputsTo(s1.txid, s1.tx, taker.locking)[0]?.token?.amount === 1_000n && change?.token?.amount === 96_500n);
	check('transfer leaves the reserved vout-0 UTXO unspent', !spent(s1.tx, genesisReady));
	const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };
	const mainnet = (lockingBytecodeToCashAddress({ prefix: 'bitcoincash', bytecode: taker.locking }) as { address: string }).address;
	check('transfer refuses mainnet addresses', (() => { try { buildPusdTransfer(PUSD, sender.address, senderUtxos, [{ address: mainnet, units: 1n }]); return false; } catch (e) { return String(e).includes('Only Chipnet'); } })());
	check('transfer refuses more PUSD than held', throws(() => buildPusdTransfer(PUSD, sender.address, senderUtxos, [{ address: taker.address, units: 100_001n }])));
	check('transfer explains when only the reserved UTXO could pay the fee', (() => {
		try { buildPusdTransfer(PUSD, sender.address, [genesisReady, fund(sender, 41, 1_000n, 100_000n)], [{ address: taker.address, units: 1n }], [`${genesisReady.txid}:0`]); return false; }
		catch (e) { return String(e).includes('oracle genesis'); }
	})());
}
// 9. User-facing error explanations.
{
	check('sign rejection explained', describeSignError({ code: 5000, message: 'User rejected' }).startsWith('You declined'));
	check('expired session explained', describeSignError(new Error('No matching key. session topic doesn\'t exist')).includes('Reconnect'));
	check('spent input (oracle contention) explained', describeBroadcastError(new Error('the transaction was rejected by network rules.\n\nbad-txns-inputs-missingorspent')).includes('already spent'));
	check('covenant failure explained', describeBroadcastError(new Error('mandatory-script-verify-flag-failed (Script failed an OP_VERIFY operation)')).includes('covenant rejected'));
}
void orderContract; void orderParams; void encodeOracleCommitment; void price;

console.log(failures === 0 ? '\nAll exchange builder checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
