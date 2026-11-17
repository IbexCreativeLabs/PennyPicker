/**
 * VM-level tests for PennyPicker covenants using libauth's BCH 2025 VM.
 * Run: pnpm --filter app exec tsx scripts/pennypicker-contracts.test.ts
 * (or: pnpm dlx tsx packages/app/scripts/pennypicker-contracts.test.ts)
 */
import {
	createVirtualMachineBch2025,
	encodeDataPush,
	hash160,
	generateSigningSerializationBch,
	hash256,
	secp256k1,
	hexToBin,
	SigningSerializationFlag,
	sha256,
	binToHex,
	type Input,
	type Output,
	type TransactionCommon
} from '@bitauth/libauth';
import {
	askFillUnitsDue,
	bidFillUnitsOut,
	bidSatsForUnits,
	encodeOracleCommitment,
	makerPkhFromPublicKey,
	oracleContract,
	oracleReadUnlocking,
	oracleUpdateUnlocking,
	orderCancelUnlocking,
	orderContract,
	orderFillUnlocking
} from '../src/lib/pennypicker/contracts';

const vm = createVirtualMachineBch2025(false);
const ORACLE_CAT = '11'.repeat(32);
const PUSD_CAT = '22'.repeat(32);
const OTHER_CAT = '33'.repeat(32);
const makerKey = hexToBin('01'.repeat(32));
const makerPk = secp256k1.derivePublicKeyCompressed(makerKey) as Uint8Array;
const makerPkh = makerPkhFromPublicKey(makerPk);
const operatorKey = hexToBin('02'.repeat(32));
const operatorPk = secp256k1.derivePublicKeyCompressed(operatorKey) as Uint8Array;
// A local stand-in for the oracles.cash signing key (same message format and signature scheme).
const oracleKey = hexToBin('03'.repeat(32));
const oraclePk = secp256k1.derivePublicKeyCompressed(oracleKey) as Uint8Array;
const operator = oracleContract({ operatorPkh: makerPkhFromPublicKey(operatorPk), oraclePublicKey: binToHex(oraclePk) });
const le = (v: bigint | number, n: number) => { const b = new Uint8Array(n); let x = BigInt(v); for (let i = 0; i < n; i++) { b[i] = Number(x & 0xffn); x >>= 8n; } return b; };
/** Oracle price message: timestamp | messageSequence | dataSequence | price (cents). */
function oracleMsg(ts: number, seq: number, dataSeq: number, cents: bigint, key = oracleKey) {
	const message = Uint8Array.from([...le(ts, 4), ...le(seq, 4), ...le(dataSeq, 4), ...le(cents, 4)]);
	return { message, signature: secp256k1.signMessageHashSchnorr(key, sha256.hash(message)) as Uint8Array };
}
// Reference 500.00 PUSD per BCH (price scaled by 1e8).
const RATE = 500n * 100_000_000n;
const oracleCommitment = encodeOracleCommitment({ price: RATE, timestamp: 1_800_000_000, sequence: 7 });
const OP_TRUE = Uint8Array.of(0x51);

let failures = 0;
function check(name: string, actual: boolean, expected: boolean) {
	const ok = actual === expected;
	if (!ok) failures++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} (valid=${actual}, expected ${expected})`);
}

function oracleUtxo(commitment = oracleCommitment, category = ORACLE_CAT, capability: 'mutable' | 'none' = 'mutable'): Output {
	return { lockingBytecode: operator.lockingBytecode, valueSatoshis: 1000n, token: { amount: 0n, category: hexToBin(category), nft: { capability, commitment } } };
}
function input(index: number, unlockingBytecode: Uint8Array): Input {
	return { outpointIndex: index, outpointTransactionHash: hash256(Uint8Array.of(index)), sequenceNumber: 0, unlockingBytecode };
}
function verify(tx: TransactionCommon, sourceOutputs: Output[]): boolean {
	const result = vm.verify({ transaction: tx, sourceOutputs });
	if (result !== true && process.env.DEBUG) console.log('   ', result);
	return result === true;
}
function fillTx(order: ReturnType<typeof orderContract>, orderIn: Output, orderOut: Output, opts: { oracleIn?: Output; oracleOut?: Output } = {}) {
	const oracleIn = opts.oracleIn ?? oracleUtxo();
	const oracleOut = opts.oracleOut ?? oracleIn;
	const taker: Output = { lockingBytecode: OP_TRUE, valueSatoshis: 100_000_000n, token: { amount: 10_000_000n, category: hexToBin(PUSD_CAT) } };
	const tx: TransactionCommon = {
		version: 2, locktime: 0,
		inputs: [input(0, oracleReadUnlocking(operator)), input(1, orderFillUnlocking(order)), input(2, new Uint8Array())],
		outputs: [oracleOut, orderOut, { lockingBytecode: OP_TRUE, valueSatoshis: 1000n }]
	};
	return { tx, sources: [oracleIn, orderIn, taker] };
}
const out = (locking: Uint8Array, value: bigint, units: bigint, category = PUSD_CAT): Output => ({ lockingBytecode: locking, valueSatoshis: value, ...(units > 0n ? { token: { amount: units, category: hexToBin(category) } } : {}) });

// --- Ask: sells BCH at +50 BPS (limit 502.50). Holds 0.1 BCH + reserve.
const base = { oracleCategory: ORACLE_CAT, pusdCategory: PUSD_CAT, makerPkh };
const ask = orderContract({ ...base, side: 'ask', deltaBps: 50 });
const askIn: Output = { lockingBytecode: ask.lockingBytecode, valueSatoshis: 10_001_000n };
const due = askFillUnitsDue(4_000_000n, RATE, 50); // 0.04 BCH
console.log('ask: 0.04 BCH costs', due, 'units (expect 2010 = 20.10 PUSD)');
check('ask price arithmetic: 0.04 BCH at 502.50 = 20.10 PUSD', due === 2_010n, true);
check('ask partial fill paying exact limit', verify(...Object.values(fillTx(ask, askIn, out(ask.lockingBytecode, 10_001_000n - 4_000_000n, due))) as [TransactionCommon, Output[]]), true);
check('ask fill paying 1 unit short', verify(...Object.values(fillTx(ask, askIn, out(ask.lockingBytecode, 10_001_000n - 4_000_000n, due - 1n))) as [TransactionCommon, Output[]]), false);
check('ask fill paid in wrong token', verify(...Object.values(fillTx(ask, askIn, out(ask.lockingBytecode, 10_001_000n - 4_000_000n, due, OTHER_CAT))) as [TransactionCommon, Output[]]), false);
check('ask rejects reverse trade (taking PUSD out)', verify(...Object.values(fillTx(ask, { ...askIn, token: { amount: 5_000n, category: hexToBin(PUSD_CAT) } }, out(ask.lockingBytecode, 10_001_000n + 10_000_000n, 0n))) as [TransactionCommon, Output[]]), false);
check('ask fill with wrong oracle category', verify(...Object.values(fillTx(ask, askIn, out(ask.lockingBytecode, 6_001_000n, due), { oracleIn: oracleUtxo(oracleCommitment, OTHER_CAT) })) as [TransactionCommon, Output[]]), false);
check('ask fill with immutable (non-oracle) NFT', verify(...Object.values(fillTx(ask, askIn, out(ask.lockingBytecode, 6_001_000n, due), { oracleIn: oracleUtxo(oracleCommitment, ORACLE_CAT, 'none') })) as [TransactionCommon, Output[]]), false);
{
	const higher = encodeOracleCommitment({ price: RATE * 2n, timestamp: 1_800_000_000, sequence: 7 });
	check('oracle read rejects altered commitment', verify(...Object.values(fillTx(ask, askIn, out(ask.lockingBytecode, 6_001_000n, due), { oracleOut: oracleUtxo(higher) })) as [TransactionCommon, Output[]]), false);
	// A higher reference raises the price the ask demands: the old payment is no longer enough.
	check('ask re-prices with a higher oracle reference', verify(...Object.values(fillTx(ask, askIn, out(ask.lockingBytecode, 6_001_000n, due), { oracleIn: oracleUtxo(higher) })) as [TransactionCommon, Output[]]), false);
}
check('ask fill redirecting continuation', verify(...Object.values(fillTx(ask, askIn, out(OP_TRUE, 6_001_000n, due))) as [TransactionCommon, Output[]]), false);

// --- Bid: buys BCH at -25 BPS (limit 498.75) with 50.00 PUSD.
const bid = orderContract({ ...base, side: 'bid', deltaBps: -25 });
const bidIn: Output = { lockingBytecode: bid.lockingBytecode, valueSatoshis: 1_000n, token: { amount: 5_000n, category: hexToBin(PUSD_CAT) } };
const paid = bidFillUnitsOut(2_000_000n, RATE, -25); // 0.02 BCH
console.log('bid: 0.02 BCH pays out', paid, 'units (expect 997 = 9.97 PUSD, floor of 9.975)');
check('bid price arithmetic: floor(0.02 × 498.75) = 9.97 PUSD', paid === 997n, true);
check('bid partial fill at exact limit', verify(...Object.values(fillTx(bid, bidIn, out(bid.lockingBytecode, 1_000n + 2_000_000n, 5_000n - paid))) as [TransactionCommon, Output[]]), true);
check('bid fill taking 1 unit too many', verify(...Object.values(fillTx(bid, bidIn, out(bid.lockingBytecode, 1_000n + 2_000_000n, 5_000n - paid - 1n))) as [TransactionCommon, Output[]]), false);
check('bid rejects reverse trade (adding PUSD, taking BCH)', verify(...Object.values(fillTx(bid, { ...bidIn, valueSatoshis: 3_000_000n }, out(bid.lockingBytecode, 1_000n, 6_000n))) as [TransactionCommon, Output[]]), false);
{
	const all = bidSatsForUnits(5_000n, RATE, -25);
	check('bid full fill (all PUSD)', verify(...Object.values(fillTx(bid, bidIn, out(bid.lockingBytecode, 1_000n + all + 1n, 0n))) as [TransactionCommon, Output[]]), true);
}
{
	const extreme = orderContract({ ...base, side: 'bid', deltaBps: -9_999 });
	const ein: Output = { ...bidIn, lockingBytecode: extreme.lockingBytecode };
	check('bid at -9999 BPS still demands BCH', verify(...Object.values(fillTx(extreme, ein, out(extreme.lockingBytecode, 1_000n, 4_999n))) as [TransactionCommon, Output[]]), false);
}

// --- Cancel / update authorised by a signed P2PKH input at index + 1.
const p2pkh = (pk: Uint8Array) => Uint8Array.from([0x76, 0xa9, 0x14, ...hash160(pk), 0x88, 0xac]);
function signP2pkh(tx: TransactionCommon, sources: Output[], inputIndex: number, key: Uint8Array, pk: Uint8Array) {
	const flags = SigningSerializationFlag.allOutputs | SigningSerializationFlag.utxos | SigningSerializationFlag.forkId;
	const preimage = generateSigningSerializationBch(
		{ inputIndex, sourceOutputs: sources, transaction: tx },
		{ coveredBytecode: sources[inputIndex]!.lockingBytecode, signingSerializationType: Uint8Array.of(flags) }
	);
	const sig = Uint8Array.from([...(secp256k1.signMessageHashSchnorr(key, hash256(preimage)) as Uint8Array), flags]);
	tx.inputs[inputIndex]!.unlockingBytecode = Uint8Array.from([...encodeDataPush(sig), ...encodeDataPush(pk)]);
}
const wallet = (pk: Uint8Array): Output => ({ lockingBytecode: p2pkh(pk), valueSatoshis: 5_000n });
{
	const mk = (authPk: Uint8Array, authKey: Uint8Array, authIndex = 1) => {
		const tx: TransactionCommon = {
			version: 2, locktime: 0,
			inputs: authIndex === 1 ? [input(1, orderCancelUnlocking(ask)), input(9, new Uint8Array())] : [input(9, new Uint8Array()), input(1, orderCancelUnlocking(ask))],
			outputs: [{ lockingBytecode: OP_TRUE, valueSatoshis: 10_000_000n }]
		};
		const sources = authIndex === 1 ? [askIn, wallet(authPk)] : [wallet(authPk), askIn];
		signP2pkh(tx, sources, authIndex === 1 ? 1 : 0, authKey, authPk);
		return verify(tx, sources);
	};
	check('maker cancel authorised by maker P2PKH input', mk(makerPk, makerKey), true);
	check('cancel authorised by another address', mk(operatorPk, operatorKey), false);
	check('cancel with maker input before (not after) the order', mk(makerPk, makerKey, 0), false);
}
// --- Oracle update: anyone, with a newer message signed by the price oracle.
{
	const mk = (signed: { message: Uint8Array; signature: Uint8Array }, commitment: Uint8Array) => {
		const tx: TransactionCommon = {
			version: 2, locktime: 0,
			inputs: [input(0, oracleUpdateUnlocking(operator, signed.signature, signed.message)), input(9, new Uint8Array())],
			outputs: [oracleUtxo(commitment), { lockingBytecode: OP_TRUE, valueSatoshis: 4_000n }]
		};
		return verify(tx, [oracleUtxo(), { lockingBytecode: OP_TRUE, valueSatoshis: 5_000n }]);
	};
	const m = oracleMsg(1_800_000_060, 8, 5, 21_072n); // 210.72
	const state = encodeOracleCommitment({ price: 21_072n * 1_000_000n, timestamp: 1_800_000_060, sequence: 8 });
	check('oracle update with a newer signed message (permissionless)', mk(m, state), true);
	check('oracle update with a forged signature', mk(oracleMsg(1_800_000_060, 8, 5, 21_072n, makerKey), state), false);
	const tampered = { ...m, message: Uint8Array.from([...m.message.slice(0, 12), ...le(30_000n, 4)]) };
	check('oracle update with an altered price in the message', mk(tampered, encodeOracleCommitment({ price: 30_000n * 1_000_000n, timestamp: 1_800_000_060, sequence: 8 })), false);
	check('oracle update writing a different price than signed', mk(m, encodeOracleCommitment({ price: 50_000n * 1_000_000n, timestamp: 1_800_000_060, sequence: 8 })), false);
	check('oracle update replaying an old message (same sequence)', mk(oracleMsg(1_800_000_060, 7, 5, 21_072n), encodeOracleCommitment({ price: 21_072n * 1_000_000n, timestamp: 1_800_000_060, sequence: 7 })), false);
	check('oracle update with a metadata message (negative type)', mk(oracleMsg(1_800_000_060, 8, -54, 21_072n), state), false);
}
// --- A real oracles.cash BCH/USD message (fetched 2026-11-17) verifies against the production key.
{
	const real = oracleContract({ operatorPkh: makerPkhFromPublicKey(operatorPk) }); // default: GP BCH/USD key
	const message = hexToBin('5c49fc6a2b751d000e751d0050520000'); // 210.72 USD, sequence 1930539
	const signature = hexToBin('91afdd390238bee6d879613e8b1294ad3d93e6340dab531bc072ccad6c28d26631a75cc7e26181cf1feb1b1e7c084e43b9e36335d97225fafae7e10a400288c0');
	const prev: Output = { ...oracleUtxo(), lockingBytecode: real.lockingBytecode };
	const next: Output = { ...prev, token: { ...prev.token!, nft: { capability: 'mutable', commitment: encodeOracleCommitment({ price: 21_072n * 1_000_000n, timestamp: 1_794_918_748, sequence: 1_930_539 }) } } };
	const tx: TransactionCommon = { version: 2, locktime: 0, inputs: [input(0, oracleUpdateUnlocking(real, signature, message)), input(9, new Uint8Array())], outputs: [next, { lockingBytecode: OP_TRUE, valueSatoshis: 4_000n }] };
	check('real oracles.cash BCH/USD message updates the state (210.72)', verify(tx, [prev, { lockingBytecode: OP_TRUE, valueSatoshis: 5_000n }]), true);
}
// --- A fill that refreshes the price in the same transaction reads the new price.
{
	const m = oracleMsg(1_800_000_060, 8, 5, 52_000n); // 520.00 → ask limit 522.60
	const newState = oracleUtxo(encodeOracleCommitment({ price: 52_000n * 1_000_000n, timestamp: 1_800_000_060, sequence: 8 }));
	const mkFill = (units: bigint) => {
		const { tx, sources } = fillTx(ask, askIn, out(ask.lockingBytecode, 10_001_000n - 4_000_000n, units), { oracleOut: newState });
		tx.inputs[0]!.unlockingBytecode = oracleUpdateUnlocking(operator, m.signature, m.message);
		return verify(tx, sources);
	};
	const dueNew = askFillUnitsDue(4_000_000n, 52_000n * 1_000_000n, 50);
	check('fill with in-transaction price update pays the new limit', mkFill(dueNew), true);
	check('fill with in-transaction update cannot pay the old price', mkFill(due), false);
}

console.log(failures === 0 ? '\nAll covenant checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
