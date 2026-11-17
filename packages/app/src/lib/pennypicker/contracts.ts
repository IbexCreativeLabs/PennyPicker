/**
 * PennyPicker covenant instantiation: oracle-state contract and per-order BPS
 * limit-order contracts, compiled with cashc 0.11.5 from `contracts/*.cash`.
 *
 * Pair convention: BCH/PUSD, price = PUSD per BCH.
 *   ask = sells BCH for PUSD (escrows BCH),  deltaBps >= 0
 *   bid = buys BCH with PUSD (escrows PUSD), deltaBps <= 0
 *   limit = reference * (10000 + deltaBps) / 10000
 *
 * Encoding follows CashScript conventions: the redeem script is the constructor
 * arguments pushed in reverse order followed by the compiled bytecode; unlocking
 * bytecode is the function arguments in reverse order, the function selector
 * (only for contracts with several functions) and the redeem script.
 */
import {
	bigIntToVmNumber,
	binToHex,
	encodeDataPush,
	hash160,
	hash256,
	hexToBin,
	OpcodesBch2023
} from '@bitauth/libauth';
import orderArtifact from './contracts/PennyPickerOrder.json';
import oracleArtifact from './contracts/PennyPickerOracle.json';

export type OrderSide = 'ask' | 'bid';

/** Oracle price: PUSD per BCH scaled by 1e8. */
export const PRICE_SCALE = 100_000_000n;
export const BPS_DENOMINATOR = 10_000n;
export const SATS_PER_BCH = 100_000_000n;
export const PUSD_UNITS_PER_PUSD = 100n;
/** dUnits * SETTLEMENT_SCALE + dSat * price * (10000 + delta) >= 0 */
export const SETTLEMENT_SCALE = 1_000_000_000_000_000_000n;
export const MIN_DELTA_BPS = -9_999;
export const MAX_DELTA_BPS = 100_000;
export const MAX_TOKEN_UNITS = (1n << 63n) - 1n;
export const ORACLE_COMMITMENT_BYTES = 16;
export const ORDER_FUNCTION = { fill: 0, cancel: 1 } as const;
export const ORACLE_FUNCTION = { update: 0, read: 1 } as const;

const opcodes = OpcodesBch2023 as unknown as Record<string, number>;

function asmToBytecode(asm: string): Uint8Array {
	const parts: Uint8Array[] = [];
	for (const token of asm.trim().split(/\s+/)) {
		if (token.startsWith('OP_')) {
			const opcode = opcodes[token];
			if (opcode === undefined) throw new Error(`Unknown opcode in artifact: ${token}`);
			parts.push(Uint8Array.of(opcode));
		} else {
			parts.push(encodeDataPush(hexToBin(token)));
		}
	}
	return concat(parts);
}

export function concat(parts: Uint8Array[]): Uint8Array {
	const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.length;
	}
	return result;
}

const orderBytecode = asmToBytecode(orderArtifact.bytecode);
const oracleBytecode = asmToBytecode(oracleArtifact.bytecode);

export function pushInt(value: bigint): Uint8Array {
	return encodeDataPush(bigIntToVmNumber(value));
}

function redeemScript(bytecode: Uint8Array, args: Uint8Array[]): Uint8Array {
	return concat([...args.slice().reverse().map((arg) => encodeDataPush(arg)), bytecode]);
}

export function p2sh32LockingBytecode(redeem: Uint8Array): Uint8Array {
	return concat([Uint8Array.of(0xaa, 0x20), hash256(redeem), Uint8Array.of(0x87)]);
}

function bytesOf(hex: string, length: number, label: string): Uint8Array {
	if (!new RegExp(`^[0-9a-fA-F]{${length * 2}}$`).test(hex)) {
		throw new Error(`${label} must be ${length}-byte hex.`);
	}
	return hexToBin(hex.toLowerCase());
}

/**
 * Token categories are written into scripts in the order used by
 * OP_UTXOTOKENCATEGORY, which is the reverse of the familiar display hex.
 */
export function categoryToVmBytes(categoryDisplayHex: string): Uint8Array {
	return bytesOf(categoryDisplayHex, 32, 'Token category').reverse();
}

export interface ContractInstance {
	redeemScript: Uint8Array;
	lockingBytecode: Uint8Array;
}

function instance(redeem: Uint8Array): ContractInstance {
	return { redeemScript: redeem, lockingBytecode: p2sh32LockingBytecode(redeem) };
}

/** General Protocols (oracles.cash) BCH/USD price oracle: prices in US cents, one message per minute. */
export const GP_BCH_USD_ORACLE = {
	publicKey: '02d09db08af1ff4e8453919cc866a4be427d7bfe18f2c05e5444c196fcf6fd2818',
	unitsPerWhole: 100n,
	relay: 'https://oracles.generalprotocols.com'
} as const;

export interface OracleContractParams {
	/** 20-byte HASH160 of the wallet that created the oracle (names the instance; no special rights). */
	operatorPkh: string;
	/** Compressed public key of the price oracle whose signed messages update the state. */
	oraclePublicKey?: string;
	/** Oracle price units per whole currency unit (BCH/USD: 100 cents). */
	unitsPerWhole?: bigint;
}

export function oracleContract(params: OracleContractParams): ContractInstance {
	return instance(
		redeemScript(oracleBytecode, [
			bytesOf(params.operatorPkh, 20, 'Operator hash'),
			bytesOf(params.oraclePublicKey ?? GP_BCH_USD_ORACLE.publicKey, 33, 'Oracle public key'),
			bigIntToVmNumber(params.unitsPerWhole ?? GP_BCH_USD_ORACLE.unitsPerWhole)
		])
	);
}

export interface OrderContractParams {
	oracleCategory: string;
	pusdCategory: string;
	makerPkh: string;
	side: OrderSide;
	deltaBps: number;
}

/** App convention: asks at or above the reference, bids at or below. */
export function assertOrderDelta(side: OrderSide, deltaBps: number): void {
	if (side !== 'ask' && side !== 'bid') throw new Error('Order side must be ask or bid.');
	if (!Number.isSafeInteger(deltaBps) || deltaBps < MIN_DELTA_BPS || deltaBps > MAX_DELTA_BPS) {
		throw new Error(`BPS must be a whole number between ${MIN_DELTA_BPS} and ${MAX_DELTA_BPS}.`);
	}
	if (side === 'ask' && deltaBps < 0) throw new Error('An ask (sell BCH) must be at or above the reference: BPS ≥ 0.');
	if (side === 'bid' && deltaBps > 0) throw new Error('A bid (buy BCH) must be at or below the reference: BPS ≤ 0.');
}

export function validateOrderParams(params: OrderContractParams): void {
	assertOrderDelta(params.side, params.deltaBps);
	bytesOf(params.makerPkh, 20, 'Maker hash');
	bytesOf(params.oracleCategory, 32, 'Oracle category');
	bytesOf(params.pusdCategory, 32, 'PUSD category');
}

export function orderContract(params: OrderContractParams): ContractInstance {
	validateOrderParams(params);
	return instance(
		redeemScript(orderBytecode, [
			categoryToVmBytes(params.oracleCategory),
			categoryToVmBytes(params.pusdCategory),
			bytesOf(params.makerPkh, 20, 'Maker hash'),
			bigIntToVmNumber(params.side === 'ask' ? 0n : 1n),
			bigIntToVmNumber(BigInt(params.deltaBps))
		])
	);
}

export function orderFillUnlocking(order: ContractInstance): Uint8Array {
	return concat([pushInt(BigInt(ORDER_FUNCTION.fill)), encodeDataPush(order.redeemScript)]);
}

/** Cancel needs no arguments: the maker authorises it with a P2PKH input at index + 1. */
export function orderCancelUnlocking(order: ContractInstance): Uint8Array {
	return concat([pushInt(BigInt(ORDER_FUNCTION.cancel)), encodeDataPush(order.redeemScript)]);
}

export function oracleReadUnlocking(oracle: ContractInstance): Uint8Array {
	return concat([pushInt(BigInt(ORACLE_FUNCTION.read)), encodeDataPush(oracle.redeemScript)]);
}

/** Permissionless update with a signed oracle message (arguments pushed in reverse order). */
export function oracleUpdateUnlocking(oracle: ContractInstance, signature: Uint8Array, message: Uint8Array): Uint8Array {
	return concat([
		encodeDataPush(message),
		encodeDataPush(signature),
		pushInt(BigInt(ORACLE_FUNCTION.update)),
		encodeDataPush(oracle.redeemScript)
	]);
}

/** A signed price message from a General Protocols oracle (16-byte message, 64-byte Schnorr signature). */
export interface OracleMessage {
	message: Uint8Array;
	signature: Uint8Array;
	timestamp: number;
	messageSequence: number;
	dataSequence: number;
	/** Oracle units, e.g. US cents for BCH/USD. */
	price: bigint;
}

export function parseOracleMessage(messageHex: string, signatureHex: string): OracleMessage {
	const message = bytesOf(messageHex, 16, 'Oracle message');
	const signature = bytesOf(signatureHex, 64, 'Oracle signature');
	const view = new DataView(message.buffer, message.byteOffset, 16);
	return {
		message,
		signature,
		timestamp: view.getUint32(0, true),
		messageSequence: view.getInt32(4, true),
		dataSequence: view.getInt32(8, true),
		price: BigInt(view.getInt32(12, true))
	};
}

/** The 16-byte state commitment the oracle contract derives from a message. */
export function oracleStateFromMessage(msg: OracleMessage, unitsPerWhole: bigint = GP_BCH_USD_ORACLE.unitsPerWhole): OracleState {
	if (msg.price <= 0n || msg.dataSequence <= 0) throw new Error('Not an oracle price message.');
	return { price: (msg.price * PRICE_SCALE) / unitsPerWhole, timestamp: msg.timestamp, sequence: msg.messageSequence };
}

export interface OracleState {
	/** PUSD per BCH, scaled by 1e8. */
	price: bigint;
	/** Operator-claimed unix seconds; not enforced on-chain. */
	timestamp: number;
	sequence: number;
}

function intLE(value: bigint, bytes: number): Uint8Array {
	const result = new Uint8Array(bytes);
	for (let index = 0; index < bytes; index++) {
		result[index] = Number((value >> BigInt(index * 8)) & 0xffn);
	}
	return result;
}

function readLE(bytes: Uint8Array): bigint {
	let result = 0n;
	for (let index = bytes.length - 1; index >= 0; index--) {
		result = (result << 8n) | BigInt(bytes[index]!);
	}
	return result;
}

const MAX_INT64 = (1n << 63n) - 1n;
const MAX_INT32 = 0x7fffffff;

/**
 * Fixed-width little-endian fields whose top bit stays clear, so OP_BIN2NUM
 * reads them as the same positive integers.
 */
export function encodeOracleCommitment(state: OracleState): Uint8Array {
	if (state.price <= 0n || state.price > MAX_INT64) {
		throw new Error('Oracle price must be positive and fit a signed 64-bit integer.');
	}
	for (const [label, value] of [
		['timestamp', state.timestamp],
		['sequence', state.sequence]
	] as const) {
		if (!Number.isSafeInteger(value) || value < 0 || value > MAX_INT32) {
			throw new Error(`Oracle ${label} must fit a positive signed 32-bit integer.`);
		}
	}
	return concat([intLE(state.price, 8), intLE(BigInt(state.timestamp), 4), intLE(BigInt(state.sequence), 4)]);
}

export function decodeOracleCommitment(commitment: Uint8Array): OracleState {
	if (commitment.length !== ORACLE_COMMITMENT_BYTES) {
		throw new Error('Oracle commitment must be 16 bytes.');
	}
	const price = readLE(commitment.slice(0, 8));
	const timestamp = Number(readLE(commitment.slice(8, 12)));
	const sequence = Number(readLE(commitment.slice(12, 16)));
	if (price <= 0n || price > MAX_INT64 || timestamp > MAX_INT32 || sequence > MAX_INT32) {
		throw new Error('Oracle commitment contains an invalid field.');
	}
	return { price, timestamp, sequence };
}

export function makerPkhFromPublicKey(publicKey: Uint8Array): string {
	return binToHex(hash160(publicKey));
}

// ------------------------------------------------------------ pricing math

/** Limit price (PUSD per BCH × 1e8), floored for display. Settlement uses the exact rational. */
export function limitPrice(price: bigint, deltaBps: number): bigint {
	return (price * (BPS_DENOMINATOR + BigInt(deltaBps))) / BPS_DENOMINATOR;
}

/** Exact covenant settlement inequality, mirrored off-chain. */
export function settlementSatisfied(dSat: bigint, dUnits: bigint, price: bigint, deltaBps: number): boolean {
	return dUnits * SETTLEMENT_SCALE + dSat * price * (BPS_DENOMINATOR + BigInt(deltaBps)) >= 0n;
}

function valueNumerator(sats: bigint, price: bigint, deltaBps: number): bigint {
	return sats * price * (BPS_DENOMINATOR + BigInt(deltaBps));
}

/** PUSD base units a taker must pay an ask for `sats` BCH (rounded up). */
export function askFillUnitsDue(sats: bigint, price: bigint, deltaBps: number): bigint {
	if (sats <= 0n) throw new Error('Fill amount must be positive.');
	return (valueNumerator(sats, price, deltaBps) + SETTLEMENT_SCALE - 1n) / SETTLEMENT_SCALE;
}

/** PUSD base units a taker may take from a bid for `sats` BCH (rounded down). */
export function bidFillUnitsOut(sats: bigint, price: bigint, deltaBps: number): bigint {
	if (sats <= 0n) throw new Error('Fill amount must be positive.');
	return valueNumerator(sats, price, deltaBps) / SETTLEMENT_SCALE;
}

/** Largest BCH amount (sats) whose bid payout fits within `units` PUSD. */
export function bidSatsForUnits(units: bigint, price: bigint, deltaBps: number): bigint {
	const perSat = price * (BPS_DENOMINATOR + BigInt(deltaBps));
	return (units * SETTLEMENT_SCALE) / perSat;
}

/** PUSD base units equal to `sats` at a reference price (floor). */
export function satsToUnits(sats: bigint, price: bigint): bigint {
	return (sats * price) / (SATS_PER_BCH * PRICE_SCALE / PUSD_UNITS_PER_PUSD);
}

/** Satoshis equal to `units` PUSD base units at a reference price (floor). */
export function unitsToSats(units: bigint, price: bigint): bigint {
	return (units * (SATS_PER_BCH * PRICE_SCALE / PUSD_UNITS_PER_PUSD)) / price;
}

/** Parse "512.34" PUSD per BCH (up to 8 decimals) to the scaled integer. */
export function parsePrice(input: string): bigint {
	const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(input.trim());
	if (!match) throw new Error('Enter a price in PUSD per BCH (up to 8 decimals).');
	const value = BigInt(match[1]!) * PRICE_SCALE + BigInt((match[2] ?? '').padEnd(8, '0') || '0');
	if (value <= 0n) throw new Error('Price must be positive.');
	return value;
}

/** Format a scaled price with `decimals` places (rounded half up). */
export function formatPrice(price: bigint, decimals = 2): string {
	const step = 10n ** BigInt(8 - decimals);
	const rounded = (price + step / 2n) / step;
	const unit = 10n ** BigInt(decimals);
	const whole = rounded / unit;
	return decimals === 0 ? `${whole}` : `${whole}.${(rounded % unit).toString().padStart(decimals, '0')}`;
}

export const contractArtifacts = {
	order: { name: orderArtifact.contractName, compiler: orderArtifact.compiler },
	oracle: { name: oracleArtifact.contractName, compiler: oracleArtifact.compiler }
};
