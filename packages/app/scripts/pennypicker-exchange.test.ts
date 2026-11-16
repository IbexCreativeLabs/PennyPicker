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

// 1. Oracle genesis (500 PUSD/BCH => 200,000 sats per PUSD).
const RATE = 200_000n * 100_000_000n;
let operatorUtxos = [fund(operator, 1, 1_000_000n)];
const genesis = buildOracleGenesis(operator.address, operator.pkh, operatorUtxos, { rateSatsPerPusdScaled: RATE, timestamp: 1_800_000_000, sequence: 1 });
const g = verify('oracle genesis', genesis, operator);
const market: MarketConfig = { pusdCategory: PUSD, oracleCategory: genesis.createdCategory!, oracleOperatorPkh: operator.pkh };
const oracleLocking = oracleContract({ operatorPkh: operator.pkh }).lockingBytecode;
let oracle = findOracleUtxo(outputsTo(g.txid, g.tx, oracleLocking), market)!;
check('oracle found after genesis', !!oracle && oracle.state.sequence === 1);
operatorUtxos = outputsTo(g.txid, g.tx, operator.locking);

// 2. Oracle update.
const upd = buildOracleUpdate(market, oracle, operator.address, operatorUtxos, { rateSatsPerPusdScaled: RATE + 1_000_000n, timestamp: 1_800_000_060, sequence: 2 });
const u = verify('oracle update authorised by operator input', upd, operator);
oracle = findOracleUtxo(outputsTo(u.txid, u.tx, oracleLocking), market)!;
const rate = oracle.state.rateSatsPerPusdScaled;
{
	let threw = false;
	try { buildOracleUpdate(market, oracle, maker.address, [fund(maker, 9, 100_000n)], { ...oracle.state, sequence: 3 }); } catch { threw = true; }
	check('non-operator cannot build an oracle update', threw);
}

// 3. Maker creates a sell order (60.00 PUSD at +100 BPS).
let makerUtxos = [fund(maker, 2, 2_000_000n), fund(maker, 3, 1_000n, 10_000n)];
const create = buildCreateOrder(market, oracle, maker.address, maker.pkh, makerUtxos, { side: 'sell-pusd', deltaBps: 100, quantityUnits: 6_000n });
const c = verify('create sell order', create, maker);
oracle = findOracleUtxo(outputsTo(c.txid, c.tx, oracleLocking), market)!;
const announced = c.tx.outputs.map((o) => parseAnnouncement(o.lockingBytecode)).find(Boolean);
check('announcement parses and matches', !!announced && describeOrder(market, announced).lockingBytecodeHex === create.order!.lockingBytecodeHex);
makerUtxos = [...outputsTo(c.txid, c.tx, maker.locking)];
const sellLocking = hexToBin(create.order!.lockingBytecodeHex);
let sellOrder = toOpenOrder(create.order!, outputsTo(c.txid, c.tx, sellLocking)[0]!, market)!;
check('sell order open with 6000 units', sellOrder.remainingUnits === 6_000n);

// 4. Maker creates a buy order (wants 40.00 PUSD at -50 BPS, 0.1 BCH escrow).
{
	let threw = false;
	try { buildCreateOrder(market, oracle, maker.address, maker.pkh, makerUtxos, { side: 'buy-pusd', deltaBps: -50, quantityUnits: 4_000n, escrowSatoshis: 10_000_000n }); } catch { threw = true; }
	check('buy order creation refuses insufficient BCH', threw);
}
const makerUtxos2 = [...makerUtxos, fund(maker, 4, 20_000_000n)];
const createBuy2 = buildCreateOrder(market, oracle, maker.address, maker.pkh, makerUtxos2, { side: 'buy-pusd', deltaBps: -50, quantityUnits: 4_000n, escrowSatoshis: 10_000_000n });
const cb = verify('create buy order', createBuy2, maker);
oracle = findOracleUtxo(outputsTo(cb.txid, cb.tx, oracleLocking), market)!;
let buyOrder = toOpenOrder(createBuy2.order!, outputsTo(cb.txid, cb.tx, hexToBin(createBuy2.order!.lockingBytecodeHex))[0]!, market)!;

// 5. Taker buys 25.00 PUSD from the sell order (partial fill).
const takerUtxos = [fund(taker, 5, 50_000_000n), fund(taker, 6, 1_000n, 5_000n)];
const fill1 = buildFillOrders(market, oracle, taker.address, takerUtxos, [{ order: sellOrder, units: 2_500n }]);
const f1 = verify('taker partial-fills sell order', fill1, taker);
oracle = findOracleUtxo(outputsTo(f1.txid, f1.tx, oracleLocking), market)!;
sellOrder = toOpenOrder(sellOrder, outputsTo(f1.txid, f1.tx, sellLocking)[0]!, market)!;
check('sell order remaining 3500', sellOrder.remainingUnits === 3_500n, `proceeds held ${sellOrder.utxo.satoshis} sats`);

// 6. Taker sells 30.00 PUSD into the buy order.
const takerAfter = outputsTo(f1.txid, f1.tx, taker.locking).concat(takerUtxos.filter((u) => !f1.tx.inputs.some((i) => binToHex(i.outpointTransactionHash) === u.txid)));
const fill2 = buildFillOrders(market, oracle, taker.address, takerAfter, [{ order: buyOrder, units: 3_000n }]);
const f2 = verify('taker fills buy order with PUSD', fill2, taker);
buyOrder = toOpenOrder(buyOrder, outputsTo(f2.txid, f2.tx, hexToBin(buyOrder.lockingBytecodeHex))[0]!, market)!;
check('buy order remaining 1000', buyOrder.remainingUnits === 1_000n);
{
	let threw = false;
	try { buildFillOrders(market, oracle, taker.address, takerAfter, [{ order: buyOrder, units: 2_000n }]); } catch { threw = true; }
	check('cannot overfill buy order target', threw);
}

// 7. Maker cancels the partially filled sell order (placeholder signature).
const cancel = buildCancelOrder(market, sellOrder, maker.address, makerUtxos2);
verify('maker cancels sell order', cancel, maker);
{
	let threw = false;
	try { buildCancelOrder(market, sellOrder, taker.address, takerUtxos); } catch { threw = true; }
	check('non-maker cannot build cancel', threw);
}
void orderContract; void orderParams; void encodeOracleCommitment;

console.log(failures === 0 ? '\nAll exchange builder checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
