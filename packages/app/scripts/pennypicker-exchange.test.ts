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
	sha256,
	SigningSerializationFlag,
	type TransactionCommon
} from '@bitauth/libauth';
import { makerPkhFromPublicKey, oracleContract, orderContract, encodeOracleCommitment, parseOracleMessage } from '../src/lib/pennypicker/contracts';
import {
	buildCancelOrder,
	buildCreateOrder,
	buildFillOrders,
	buildOracleGenesis,
	buildOracleRefresh,
	buildPusdTransfer,
	buildIdentitySeparation,
	buildPusdGenesis,
	buildBcmrPublication,
	describeOrder,
	findOracleUtxo,
	lockingBytecodeToAddress,
	lockingBytecodeToChipnetAddress,
	orderValueUnits,
	orderParams,
	p2pkhLockingBytecode,
	parseAnnouncement,
	toOpenOrder,
	type ChainUtxo,
	type MarketConfig,
	type UnsignedExchangeTransaction
} from '../src/lib/pennypicker/exchange';

import { describeBroadcastError, describeSignError } from '../src/lib/pennypicker/ui/txErrors';
import { makerPkhFromAddress } from '../src/lib/pennypicker/orderCommitment';
import { networkOfAddress } from '../src/lib/pennypicker/network';
import { assertBroadcastAllowed, loadMarketConfig } from '../src/lib/pennypicker/chain';
import { MAINNET_MAX_ORDER_UNITS, MAINNET_WRITES_ENABLED, MARKETS, PARYONUSD_CATEGORY } from '../src/lib/pennypicker/deployment';

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
// Local stand-in for the oracles.cash signing key (same message format and Schnorr-over-sha256 signature).
const oracleSigner = key('0d');
const ORACLE_PK = binToHex(oracleSigner.pub);
const le = (v: bigint | number, n: number) => { const b = new Uint8Array(n); let x = BigInt(v); for (let i = 0; i < n; i++) { b[i] = Number(x & 0xffn); x >>= 8n; } return b; };
function signedPrice(ts: number, seq: number, cents: bigint) {
	const message = Uint8Array.from([...le(ts, 4), ...le(seq, 4), ...le(seq, 4), ...le(cents, 4)]);
	const signature = secp256k1.signMessageHashSchnorr(oracleSigner.priv, sha256.hash(message)) as Uint8Array;
	return parseOracleMessage(binToHex(message), binToHex(signature));
}
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
	const unconfirmed = buildOracleGenesis(operator.address, operator.pkh, [{ ...operatorUtxos[0]!, height: 0 }], { price: RATE, timestamp: 1_800_000_000, sequence: 1 });
	check('oracle genesis accepts an unconfirmed vout 0', unconfirmed.createdCategory === operatorUtxos[0]!.txid);
	let threw = false;
	try { buildOracleGenesis(operator.address, operator.pkh, [{ ...operatorUtxos[0]!, vout: 1 }], { price: RATE, timestamp: 1_800_000_000, sequence: 1 }); } catch { threw = true; }
	check('oracle genesis refuses without a vout-0 input', threw);
}
const genesis = buildOracleGenesis(operator.address, operator.pkh, [...operatorUtxos, fund(operator, 99, 5_000n, 7n)], { price: RATE, timestamp: 1_800_000_000, sequence: 1 }, ORACLE_PK);
const g = verify('oracle genesis', genesis, operator);
check('oracle genesis spends only the vout-0 input', genesis.transaction.inputs.length === 1);
const market: MarketConfig = { pusdCategory: PUSD, oracleCategory: genesis.createdCategory!, oracleOperatorPkh: operator.pkh, oraclePublicKey: ORACLE_PK };
const oracleLocking = oracleContract({ operatorPkh: operator.pkh, oraclePublicKey: ORACLE_PK }).lockingBytecode;
let oracle = findOracleUtxo(outputsTo(g.txid, g.tx, oracleLocking), market)!;
check('oracle found after genesis', !!oracle && oracle.state.sequence === 1 && oracle.state.price === RATE);
operatorUtxos = outputsTo(g.txid, g.tx, operator.locking);

// 2. Anyone (here the maker) moves the reference to 520.00 with a signed oracle message.
const upd = buildOracleRefresh(market, oracle, maker.address, [fund(maker, 8, 100_000n)], signedPrice(1_800_000_060, 2, 52_000n));
const u = verify('oracle refresh with a signed oracle message (permissionless)', upd, maker);
oracle = findOracleUtxo(outputsTo(u.txid, u.tx, oracleLocking), market)!;
const price = oracle.state.price;
check('refreshed state is 520.00 at message #2', price === 520n * 100_000_000n && oracle.state.sequence === 2);
{
	let threw = false;
	try { buildOracleRefresh(market, oracle, maker.address, [fund(maker, 9, 100_000n)], signedPrice(1_800_000_060, 2, 60_000n)); } catch { threw = true; }
	check('refresh refuses a message that is not newer', threw);
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
// 10. Token identity: separation and safeguards (mirrors Chipnet: whole supply on the identity output).
{
	const owner = key('0e');
	const SUPPLY = 100_000_000n; // 1,000,000.00 PUSD
	const identity: ChainUtxo = { ...fund(owner, 50, 1_000n, SUPPLY), identityOf: PUSD };
	const bch: ChainUtxo = { ...fund(owner, 51, 513_747n), vout: 1 };
	const wallet = [identity, bch];
	const throwsWith = (f: () => unknown, text: string) => { try { f(); return false; } catch (e) { return String(e).includes(text); } };

	// Attempted identity spends are refused (no reliance on the wallet).
	check('send refuses to spend the identity output', throwsWith(() => buildPusdTransfer(PUSD, owner.address, wallet, [{ address: taker.address, units: 10_000n }]), 'separate the identity first'));
	check('bid refuses to spend the identity output', throwsWith(() => buildCreateOrder(market, oracle, owner.address, owner.pkh, wallet, { side: 'bid', deltaBps: -10, amount: 10_000n }), 'Insufficient PUSD'));
	check('ask fill refuses to spend the identity output', throwsWith(() => buildFillOrders(market, oracle, owner.address, wallet, [{ order: askOrder, sats: 1_000_000n }]), 'Insufficient PUSD'));
	const bchIdentity: ChainUtxo = { ...fund(owner, 52, 900_000n), identityOf: PUSD };
	check('a BCH-only identity output is never used as funding', throwsWith(() => buildCreateOrder(market, oracle, owner.address, owner.pkh, [bchIdentity], { side: 'ask', deltaBps: 10, amount: 100_000n }), 'Insufficient BCH'));
	check('oracle genesis will not consume an identity output', throwsWith(() => buildOracleGenesis(owner.address, owner.pkh, [bchIdentity], { price: RATE, timestamp: 1, sequence: 1 }), 'output index 0'));

	// The separation transaction.
	const sep = buildIdentitySeparation(PUSD, owner.address, wallet, { txid: identity.txid, vout: 0 });
	const sv = verify('identity separation verifies in the VM', sep, owner);
	const out = sv.tx.outputs;
	check('separation input 0 is the identity output', binToHex(sv.tx.inputs[0]!.outpointTransactionHash) === identity.txid && sv.tx.inputs[0]!.outpointIndex === 0);
	check('separation spends only the identity and BCH-only coins', sv.tx.inputs.length === 2 && spent(sv.tx, bch));
	check('output 0 is BCH-only to the owner (identity stays)', binToHex(out[0]!.lockingBytecode) === binToHex(owner.locking) && !out[0]!.token);
	check('output 1 returns the full supply in the same category', binToHex(out[1]!.lockingBytecode) === binToHex(owner.locking) && binToHex(out[1]!.token!.category) === PUSD && out[1]!.token!.amount === SUPPLY);
	check('BCH change comes after the token output', out.length === 3 && !out[2]!.token && binToHex(out[2]!.lockingBytecode) === binToHex(owner.locking));
	check('every output pays the owner', out.every((o) => binToHex(o.lockingBytecode) === binToHex(owner.locking)));
	const tokenIn = sep.sourceOutputs.reduce((sum, o) => sum + (o.token?.amount ?? 0n), 0n);
	const tokenOut = out.reduce((sum, o) => sum + (o.token?.amount ?? 0n), 0n);
	check('token amounts are conserved exactly', tokenIn === SUPPLY && tokenOut === SUPPLY);
	check('separation refuses an outpoint the wallet does not hold', throwsWith(() => buildIdentitySeparation(PUSD, owner.address, [bch], { txid: identity.txid, vout: 0 }), 'not an unspent output'));
	check('separation refuses an identity output with no tokens', throwsWith(() => buildIdentitySeparation(PUSD, owner.address, [bchIdentity, bch], { txid: bchIdentity.txid, vout: 0 }), 'nothing to separate'));
	check('separation refuses a non-zero output index', throwsWith(() => buildIdentitySeparation(PUSD, owner.address, wallet, { txid: bch.txid, vout: 1 }), 'output 0'));

	// After separation: the new identity is out 0 (BCH-only); PUSD at out 1 is freely usable.
	const after = outputsTo(sv.txid, sv.tx, owner.locking).map((u) => (u.vout === 0 ? { ...u, identityOf: PUSD } : u));
	const send = buildPusdTransfer(PUSD, owner.address, after, [{ address: taker.address, units: 10_000n }]);
	verify('after separation, a PUSD send verifies', send, owner);
	check('after separation, the send leaves the identity unspent', !spent(send.transaction, after.find((u) => u.vout === 0)!));
	const bid = buildCreateOrder(market, oracle, owner.address, owner.pkh, after, { side: 'bid', deltaBps: -10, amount: 10_000n });
	check('after separation, a bid leaves the identity unspent', !spent(bid.transaction, after.find((u) => u.vout === 0)!));
}
// 11. PUSD genesis with the identity kept apart from the supply.
{
	const creator = key('0f');
	const SUPPLY = 100_000_000n;
	const g0 = fund(creator, 60, 400_000n);
	const extra: ChainUtxo = { ...fund(creator, 61, 50_000n), vout: 2 };
	const gen = buildPusdGenesis(creator.address, [extra, g0], SUPPLY);
	const gv = verify('PUSD genesis verifies in the VM', gen, creator);
	check('genesis spends the vout-0 coin first (category = its txid)', binToHex(gv.tx.inputs[0]!.outpointTransactionHash) === g0.txid && gen.createdCategory === g0.txid);
	check('genesis output 0 is a BCH-only identity output to the creator', !gv.tx.outputs[0]!.token && binToHex(gv.tx.outputs[0]!.lockingBytecode) === binToHex(creator.locking));
	const tokenOuts = gv.tx.outputs.filter((o) => o.token);
	check('genesis output 1 holds the entire supply', tokenOuts.length === 1 && gv.tx.outputs[1]!.token?.amount === SUPPLY && binToHex(gv.tx.outputs[1]!.token!.category) === g0.txid && !gv.tx.outputs[1]!.token!.nft);
	check('genesis pays nobody else', gv.tx.outputs.every((o) => binToHex(o.lockingBytecode) === binToHex(creator.locking)));
	// After genesis the supply is spendable without touching the identity.
	const created = outputsTo(gv.txid, gv.tx, creator.locking).map((u) => (u.vout === 0 ? { ...u, identityOf: g0.txid } : u));
	const send = buildPusdTransfer(g0.txid, creator.address, created, [{ address: taker.address, units: 100_000n }]);
	verify('first PUSD send after genesis verifies', send, creator);
	check('first send leaves the identity output unspent', !send.transaction.inputs.some((i) => binToHex(i.outpointTransactionHash) === gv.txid && i.outpointIndex === 0));
	let refused = false;
	try { buildPusdGenesis('bitcoincash:qq3gfs2492tlz2nckgpq6wn28fcd80lucvcv23a9ku', [g0], SUPPLY); } catch { refused = true; }
	check('genesis refuses a mainnet address', refused);
}
// 12. A fill that carries a newer oracle message updates the reference and settles at it.
{
	const asker = key('11');
	const buyer = key('12');
	const ca2 = buildCreateOrder(market, oracle, asker.address, asker.pkh, [fund(asker, 70, 5_000_000n)], { side: 'ask', deltaBps: 0, amount: 1_000_000n });
	const c2 = verify('create ask for refresh test', ca2, asker);
	const o2 = findOracleUtxo(outputsTo(c2.txid, c2.tx, oracleLocking), market)!;
	const askUtxo = outputsTo(c2.txid, c2.tx, hexToBin(ca2.order!.lockingBytecodeHex))[0]!;
	const open = toOpenOrder(ca2.order!, askUtxo, market)!;
	const msg = signedPrice(1_800_000_120, o2.state.sequence + 5, 60_000n); // 600.00
	const fr = buildFillOrders(market, o2, buyer.address, [fund(buyer, 71, 100_000n), fund(buyer, 72, 1_000n, 100_000n)], [{ order: open, sats: 500_000n }], msg);
	const fv = verify('fill with a bundled oracle refresh', fr, buyer);
	const after = findOracleUtxo(outputsTo(fv.txid, fv.tx, oracleLocking), market)!;
	check('bundled refresh moved the reference to 600.00', after.state.price === 600n * 100_000_000n && after.state.sequence === msg.messageSequence);
	check('the fill settled at the refreshed price (0.005 BCH = 3.00 PUSD)', fv.tx.outputs[1]!.token?.amount === 300n);
}
// 13. Mainnet: same covenants with ParyonUSD, mainnet addresses, the per-order cap and the broadcast switch.
{
	const mainKey = (byte: string) => {
		const k = key(byte);
		return { ...k, address: lockingBytecodeToAddress(k.locking, 'mainnet') };
	};
	const mOperator = mainKey('21');
	const mMaker = mainKey('22');
	const mTaker = mainKey('23');
	check('mainnet address uses the bitcoincash: prefix', mMaker.address.startsWith('bitcoincash:') && networkOfAddress(mMaker.address) === 'mainnet');
	check('mainnet maker hash extracted', makerPkhFromAddress(mMaker.address, 'mainnet') === mMaker.pkh);
	let wrongNet = false;
	try { makerPkhFromAddress(maker.address, 'mainnet'); } catch { wrongNet = true; }
	check('a Chipnet address is refused as a mainnet maker', wrongNet);
	let wrongNet2 = false;
	try { makerPkhFromAddress(mMaker.address, 'chipnet'); } catch { wrongNet2 = true; }
	check('a mainnet address is refused as a Chipnet maker', wrongNet2);

	const cfg = loadMarketConfig('mainnet');
	check('mainnet config: ParyonUSD category, capped, network set', cfg.pusdCategory === PARYONUSD_CATEGORY && cfg.maxOrderUnits === MAINNET_MAX_ORDER_UNITS && cfg.network === 'mainnet');
	check('mainnet config has no oracle until it is deployed', !cfg.oracleCategory);
	const paryon = MARKETS.find((m) => m.id === 'paryonusd')!;
	check('ParyonUSD market is view-only in this build', paryon.status === 'view-only' && paryon.network === 'mainnet' && !!paryon.statusReason);
	check('mainnet writes are switched off in this build', MAINNET_WRITES_ENABLED === false);
	let blocked = '';
	try { assertBroadcastAllowed('mainnet'); } catch (e) { blocked = String(e); }
	check('mainnet broadcast is refused', blocked.includes('switched off'));
	check('the refusal is shown verbatim to the user', describeBroadcastError(new Error(blocked.replace(/^Error: /, ''))).startsWith('Mainnet transactions are switched off'));
	let chipnetOk = true;
	try { assertBroadcastAllowed('chipnet'); assertBroadcastAllowed('mainnet', true); } catch { chipnetOk = false; }
	check('Chipnet broadcast (and an explicitly enabled mainnet) is allowed', chipnetOk);

	const mg = buildOracleGenesis(mOperator.address, mOperator.pkh, [{ ...fund(mOperator, 200, 1_000_000n) }], { price: RATE, timestamp: 1_800_000_000, sequence: 1 }, ORACLE_PK);
	const mgv = verify('mainnet oracle genesis verifies', mg, mOperator);
	const mMarket: MarketConfig = { pusdCategory: PARYONUSD_CATEGORY, oracleCategory: mg.createdCategory!, oracleOperatorPkh: mOperator.pkh, oraclePublicKey: ORACLE_PK, network: 'mainnet', maxOrderUnits: MAINNET_MAX_ORDER_UNITS };
	const mLocking = oracleContract({ operatorPkh: mOperator.pkh, oraclePublicKey: ORACLE_PK }).lockingBytecode;
	let mOracle = findOracleUtxo(outputsTo(mgv.txid, mgv.tx, mLocking), mMarket)!;
	check('mainnet oracle found', !!mOracle && mOracle.state.price === RATE);

	// Cap at 500.00/BCH: 25.00 PUSD = 0.05 BCH.
	check('order value of 0.05 BCH at 500.00 is 25.00 PUSD', orderValueUnits('ask', 5_000_000n, RATE) === 2_500n);
	const capRefused = (f: () => unknown) => { try { f(); return false; } catch (e) { return String(e).includes('limited to 25.00 PUSD'); } };
	check('mainnet ask over the cap (0.0501 BCH) is refused', capRefused(() => buildCreateOrder(mMarket, mOracle, mMaker.address, mMaker.pkh, [fund(mMaker, 201, 10_000_000n)], { side: 'ask', deltaBps: 0, amount: 5_010_000n })));
	const pusdFund = (owner: ReturnType<typeof mainKey>, seed: number, units: bigint): ChainUtxo => ({ ...fund(owner, seed, 1_000n), token: { category: PARYONUSD_CATEGORY, amount: units } });
	check('mainnet bid over the cap (25.01 PUSD) is refused', capRefused(() => buildCreateOrder(mMarket, mOracle, mMaker.address, mMaker.pkh, [fund(mMaker, 202, 100_000n), pusdFund(mMaker, 203, 10_000n)], { side: 'bid', deltaBps: 0, amount: 2_501n })));
	check('the cap does not apply to Chipnet markets', !capRefused(() => buildCreateOrder(market, oracle, maker.address, maker.pkh, [fund(maker, 204, 10_000_000n)], { side: 'ask', deltaBps: 0, amount: 5_010_000n })));

	const ask = buildCreateOrder(mMarket, mOracle, mMaker.address, mMaker.pkh, [fund(mMaker, 205, 10_000_000n)], { side: 'ask', deltaBps: 25, amount: 4_000_000n });
	check('mainnet order contract has a mainnet address', ask.order!.address.startsWith('bitcoincash:'));
	const av = verify('mainnet ask within the cap (0.04 BCH) verifies', ask, mMaker);
	mOracle = findOracleUtxo(outputsTo(av.txid, av.tx, mLocking), mMarket)!;
	const bid = buildCreateOrder(mMarket, mOracle, mMaker.address, mMaker.pkh, [fund(mMaker, 206, 100_000n), pusdFund(mMaker, 207, 10_000n)], { side: 'bid', deltaBps: -25, amount: 2_500n });
	const bv = verify('mainnet bid at exactly the cap (25.00 PUSD) verifies', bid, mMaker);
	mOracle = findOracleUtxo(outputsTo(bv.txid, bv.tx, mLocking), mMarket)!;
	const askOpen = toOpenOrder(ask.order!, outputsTo(av.txid, av.tx, hexToBin(ask.order!.lockingBytecodeHex))[0]!, mMarket)!;
	const fill = buildFillOrders(mMarket, mOracle, mTaker.address, [fund(mTaker, 208, 100_000n), pusdFund(mTaker, 209, 5_000n)], [{ order: askOpen, sats: 1_000_000n }]);
	const fv = verify('mainnet fill of the ParyonUSD ask verifies', fill, mTaker);
	// 0.01 BCH × 500 × 1.0025 = 5.0125 → 5.02 PUSD to the maker (rounded up).
	const paid = fv.tx.outputs[1]!;
	check('mainnet fill pays the ask 5.02 ParyonUSD (0.01 BCH × 500 × 1.0025, rounded up)', binToHex(paid.lockingBytecode) === ask.order!.lockingBytecodeHex && !!paid.token && binToHex(paid.token.category) === PARYONUSD_CATEGORY && paid.token.amount === 502n);
}
// 14. A stale ID saved in the browser never overrides the committed deployment (and is cleaned up).
{
	const store = new Map<string, string>();
	(globalThis as { localStorage?: unknown }).localStorage = {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k)
	};
	store.set('pennypicker:chipnet:oracle-category', '88'.repeat(32));
	const cfg = loadMarketConfig('chipnet');
	check('committed oracle category wins over a stale saved one', cfg.source.oracleCategory === 'default' && cfg.oracleCategory !== '88'.repeat(32));
	check('the stale saved oracle category is removed', !store.has('pennypicker:chipnet:oracle-category'));
	delete (globalThis as { localStorage?: unknown }).localStorage;
}
// 15. BCMR publication: spends the identity output, recreates it at output 0, OP_RETURN BCMR <hash> <uri>.
{
	const owner = key('31');
	const identity = { ...fund(owner, 230, 1_000n), vout: 0 };
	const hash = 'ab'.repeat(32);
	const pub = buildBcmrPublication(PUSD, owner.address, [identity, { ...fund(owner, 231, 50_000n), vout: 1 }], identity, hash, ['pennypicker.pages.dev']);
	const pv = verify('BCMR publication verifies', pub, owner);
	check('publication spends the identity output at input 0', binToHex(pv.tx.inputs[0]!.outpointTransactionHash) === identity.txid && pv.tx.inputs[0]!.outpointIndex === 0);
	check('output 0 is the next identity output to the owner, BCH only', binToHex(pv.tx.outputs[0]!.lockingBytecode) === binToHex(owner.locking) && !pv.tx.outputs[0]!.token);
	const expected = '6a0442434d5220' + hash + '15' + binToHex(new TextEncoder().encode('pennypicker.pages.dev'));
	check('output 1 is OP_RETURN BCMR <hash> <uri>', binToHex(pv.tx.outputs[1]!.lockingBytecode) === expected);
	let refused = false;
	try { buildBcmrPublication(PUSD, owner.address, [{ ...identity, token: { category: PUSD, amount: 5n } }], identity, hash, ['x']); } catch { refused = true; }
	check('publication refuses an identity output that still holds tokens', refused);
}
void orderContract; void orderParams; void encodeOracleCommitment; void price;

console.log(failures === 0 ? '\nAll exchange builder checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
