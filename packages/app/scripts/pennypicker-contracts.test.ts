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
	type Input,
	type Output,
	type TransactionCommon
} from '@bitauth/libauth';
import {
	buyFillTakeSats,
	encodeOracleCommitment,
	makerPkhFromPublicKey,
	oracleContract,
	oracleReadUnlocking,
	oracleUpdateUnlocking,
	orderCancelUnlocking,
	orderContract,
	orderFillUnlocking,
	sellFillPaymentSats
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
const operator = oracleContract({ operatorPkh: makerPkhFromPublicKey(operatorPk) });
// 500 PUSD per BCH => 200,000 sats per PUSD, scaled 1e8.
const RATE = 200_000n * 100_000_000n;
const oracleCommitment = encodeOracleCommitment({ rateSatsPerPusdScaled: RATE, timestamp: 1_800_000_000, sequence: 7 });
const OP_TRUE = Uint8Array.of(0x51);

let failures = 0;
function check(name: string, actual: boolean, expected: boolean) {
	const ok = actual === expected;
	if (!ok) failures++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} (valid=${actual}, expected ${expected})`);
}

function oracleUtxo(commitment = oracleCommitment, category = ORACLE_CAT, capability: 'mutable' | 'none' = 'mutable'): Output {
	return {
		lockingBytecode: operator.lockingBytecode,
		valueSatoshis: 1000n,
		token: { amount: 0n, category: hexToBin(category), nft: { capability, commitment } }
	};
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
	const taker: Output = { lockingBytecode: OP_TRUE, valueSatoshis: 100_000_000n, token: { amount: 1_000_000n, category: hexToBin(PUSD_CAT) } };
	const tx: TransactionCommon = {
		version: 2,
		locktime: 0,
		inputs: [input(0, oracleReadUnlocking(operator)), input(1, orderFillUnlocking(order)), input(2, new Uint8Array())],
		outputs: [oracleOut, orderOut, { lockingBytecode: OP_TRUE, valueSatoshis: 1000n }]
	};
	return { tx, sources: [oracleIn, orderIn, taker] };
}

// --- Sell order: 100.00 PUSD at +50 BPS.
const sellParams = { oracleCategory: ORACLE_CAT, pusdCategory: PUSD_CAT, makerPkh, side: 'sell-pusd' as const, deltaBps: 50, targetUnits: 10_000n };
const sell = orderContract(sellParams);
const sellIn: Output = { lockingBytecode: sell.lockingBytecode, valueSatoshis: 1000n, token: { amount: 10_000n, category: hexToBin(PUSD_CAT) } };
const pay40 = sellFillPaymentSats(4_000n, RATE, 50); // 40 PUSD
console.log('sell 40 PUSD payment sats', pay40);
const sellOut = (units: bigint, value: bigint): Output => ({ lockingBytecode: sell.lockingBytecode, valueSatoshis: value, ...(units > 0n ? { token: { amount: units, category: hexToBin(PUSD_CAT) } } : {}) });
{
	const { tx, sources } = fillTx(sell, sellIn, sellOut(6_000n, 1000n + pay40));
	check('sell partial fill at exact limit', verify(tx, sources), true);
}
{
	const { tx, sources } = fillTx(sell, sellIn, sellOut(6_000n, 1000n + pay40 - 1n));
	check('sell fill underpaying by 1 sat', verify(tx, sources), false);
}
{
	const all = sellFillPaymentSats(10_000n, RATE, 50);
	const { tx, sources } = fillTx(sell, sellIn, sellOut(0n, 1000n + all));
	check('sell full fill', verify(tx, sources), true);
}
{
	const { tx, sources } = fillTx(sell, sellIn, sellOut(12_000n, 1000n));
	check('sell order rejects reverse (adding PUSD)', verify(tx, sources), false);
}
{
	const { tx, sources } = fillTx(sell, sellIn, sellOut(6_000n, 1000n + pay40), { oracleIn: oracleUtxo(oracleCommitment, OTHER_CAT) });
	check('sell fill with wrong oracle category', verify(tx, sources), false);
}
{
	const { tx, sources } = fillTx(sell, sellIn, sellOut(6_000n, 1000n + pay40), { oracleIn: oracleUtxo(oracleCommitment, ORACLE_CAT, 'none') });
	check('sell fill with immutable (non-oracle) NFT', verify(tx, sources), false);
}
{
	const lower = encodeOracleCommitment({ rateSatsPerPusdScaled: RATE / 2n, timestamp: 1_800_000_000, sequence: 7 });
	const { tx, sources } = fillTx(sell, sellIn, sellOut(6_000n, 1000n + pay40), { oracleIn: oracleUtxo(), oracleOut: oracleUtxo(lower) });
	check('oracle read rejects altered commitment', verify(tx, sources), false);
}
{
	const out = sellOut(6_000n, 1000n + pay40);
	out.lockingBytecode = OP_TRUE;
	const { tx, sources } = fillTx(sell, sellIn, out);
	check('sell fill redirecting continuation', verify(tx, sources), false);
}

// --- Buy order: wants 50.00 PUSD at -25 BPS, escrows 0.11 BCH.
const buy = orderContract({ ...sellParams, side: 'buy-pusd', deltaBps: -25, targetUnits: 5_000n });
const buyIn: Output = { lockingBytecode: buy.lockingBytecode, valueSatoshis: 11_000_000n };
const take20 = buyFillTakeSats(2_000n, RATE, -25);
console.log('buy 20 PUSD take sats', take20);
const buyOut = (units: bigint, value: bigint, category = PUSD_CAT): Output => ({ lockingBytecode: buy.lockingBytecode, valueSatoshis: value, token: { amount: units, category: hexToBin(category) } });
{
	const { tx, sources } = fillTx(buy, buyIn, buyOut(2_000n, 11_000_000n - take20));
	check('buy partial fill at exact limit', verify(tx, sources), true);
}
{
	const { tx, sources } = fillTx(buy, buyIn, buyOut(2_000n, 11_000_000n - take20 - 1n));
	check('buy fill overtaking by 1 sat', verify(tx, sources), false);
}
{
	const { tx, sources } = fillTx(buy, buyIn, buyOut(2_000n, 11_000_000n - take20, OTHER_CAT));
	check('buy fill paid in wrong token', verify(tx, sources), false);
}
{
	const { tx, sources } = fillTx(buy, buyIn, buyOut(6_000n, 11_000_000n - buyFillTakeSats(6_000n, RATE, -25)));
	check('buy fill beyond target quantity', verify(tx, sources), false);
}
{
	const second: Output = { lockingBytecode: buy.lockingBytecode, valueSatoshis: 11_000_000n - take20, token: { amount: 2_000n, category: hexToBin(PUSD_CAT) } };
	const t2 = buyFillTakeSats(3_000n, RATE, -25);
	const { tx, sources } = fillTx(buy, second, buyOut(5_000n, second.valueSatoshis - t2));
	check('buy second fill completes target', verify(tx, sources), true);
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
			inputs: authIndex === 1 ? [input(1, orderCancelUnlocking(sell)), input(9, new Uint8Array())] : [input(9, new Uint8Array()), input(1, orderCancelUnlocking(sell))],
			outputs: [{ lockingBytecode: OP_TRUE, valueSatoshis: 3_000n, token: { amount: 10_000n, category: hexToBin(PUSD_CAT) } }]
		};
		const sources = authIndex === 1 ? [sellIn, wallet(authPk)] : [wallet(authPk), sellIn];
		signP2pkh(tx, sources, authIndex === 1 ? 1 : 0, authKey, authPk);
		return verify(tx, sources);
	};
	check('maker cancel authorised by maker P2PKH input', mk(makerPk, makerKey), true);
	check('cancel authorised by another address', mk(operatorPk, operatorKey), false);
	check('cancel with maker input before (not after) the order', mk(makerPk, makerKey, 0), false);
}
{
	const next = encodeOracleCommitment({ rateSatsPerPusdScaled: RATE + 1n, timestamp: 1_800_000_060, sequence: 8 });
	const mk = (commitment: Uint8Array, key: Uint8Array, pk: Uint8Array) => {
		const tx: TransactionCommon = {
			version: 2, locktime: 0,
			inputs: [input(0, oracleUpdateUnlocking(operator)), input(9, new Uint8Array())],
			outputs: [oracleUtxo(commitment), { lockingBytecode: p2pkh(pk), valueSatoshis: 4_000n }]
		};
		const sources = [oracleUtxo(), wallet(pk)];
		signP2pkh(tx, sources, 1, key, pk);
		return verify(tx, sources);
	};
	check('oracle update by operator', mk(next, operatorKey, operatorPk), true);
	check('oracle update by other address', mk(next, makerKey, makerPk), false);
	const replay = encodeOracleCommitment({ rateSatsPerPusdScaled: RATE + 1n, timestamp: 1_800_000_060, sequence: 7 });
	check('oracle update without sequence increase', mk(replay, operatorKey, operatorPk), false);
	const backwards = encodeOracleCommitment({ rateSatsPerPusdScaled: RATE + 1n, timestamp: 1_799_999_999, sequence: 8 });
	check('oracle update with timestamp moving backwards', mk(backwards, operatorKey, operatorPk), false);
}

console.log(failures === 0 ? '\nAll covenant checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
