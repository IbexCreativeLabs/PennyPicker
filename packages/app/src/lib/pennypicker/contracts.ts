/**
 * PennyPicker covenant instantiation: oracle-state contract and per-order BPS
 * limit-order contracts, compiled with cashc 0.11.5 from `contracts/*.cash`.
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
import { MAX_TOKEN_UNITS, assertSideDelta, type OrderSide } from './market';

export const ORACLE_COMMITMENT_BYTES = 16;
/** dSat * SETTLEMENT_SCALE + dUnits * rate * (10000 + delta) >= 0 */
export const SETTLEMENT_SCALE = 100_000_000_000_000n;
export const ORDER_FUNCTION = { fill: 0, cancel: 1 } as const;
export const ORACLE_FUNCTION = { update: 0, read: 1 } as const;
/** CashScript pushes 65-/33-byte zero placeholders that WalletConnect signers replace. */
export const PLACEHOLDER_SIGNATURE = new Uint8Array(65);
export const PLACEHOLDER_PUBLIC_KEY = new Uint8Array(33);

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
	scriptHashHex: string;
}

function instance(redeem: Uint8Array): ContractInstance {
	const lockingBytecode = p2sh32LockingBytecode(redeem);
	return {
		redeemScript: redeem,
		lockingBytecode,
		// Electrum script hash: sha256 of the locking bytecode, byte-reversed.
		scriptHashHex: ''
	};
}

export interface OracleContractParams {
	/** 20-byte HASH160 of the operator's public key. */
	operatorPkh: string;
}

export function oracleContract(params: OracleContractParams): ContractInstance {
	return instance(redeemScript(oracleBytecode, [bytesOf(params.operatorPkh, 20, 'Operator hash')]));
}

export interface OrderContractParams {
	oracleCategory: string;
	pusdCategory: string;
	makerPkh: string;
	side: OrderSide;
	deltaBps: number;
	/** Buy orders: PUSD base units to acquire. Sell orders: PUSD base units offered (informational). */
	targetUnits: bigint;
}

export function validateOrderParams(params: OrderContractParams): void {
	assertSideDelta(params.side, params.deltaBps);
	if (params.targetUnits <= 0n || params.targetUnits > MAX_TOKEN_UNITS) {
		throw new Error('Order quantity must be positive and fit the CashToken amount range.');
	}
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
			bigIntToVmNumber(params.side === 'buy-pusd' ? 0n : 1n),
			bigIntToVmNumber(BigInt(params.deltaBps)),
			bigIntToVmNumber(params.targetUnits)
		])
	);
}

export function orderFillUnlocking(order: ContractInstance): Uint8Array {
	return concat([pushInt(BigInt(ORDER_FUNCTION.fill)), encodeDataPush(order.redeemScript)]);
}

export function orderCancelUnlocking(
	order: ContractInstance,
	signature: Uint8Array = PLACEHOLDER_SIGNATURE,
	publicKey: Uint8Array = PLACEHOLDER_PUBLIC_KEY
): Uint8Array {
	return concat([
		encodeDataPush(signature),
		encodeDataPush(publicKey),
		pushInt(BigInt(ORDER_FUNCTION.cancel)),
		encodeDataPush(order.redeemScript)
	]);
}

export function oracleReadUnlocking(oracle: ContractInstance): Uint8Array {
	return concat([pushInt(BigInt(ORACLE_FUNCTION.read)), encodeDataPush(oracle.redeemScript)]);
}

export function oracleUpdateUnlocking(
	oracle: ContractInstance,
	signature: Uint8Array = PLACEHOLDER_SIGNATURE,
	publicKey: Uint8Array = PLACEHOLDER_PUBLIC_KEY
): Uint8Array {
	return concat([
		encodeDataPush(signature),
		encodeDataPush(publicKey),
		pushInt(BigInt(ORACLE_FUNCTION.update)),
		encodeDataPush(oracle.redeemScript)
	]);
}

export interface OracleState {
	/** Satoshis per whole PUSD, scaled by 1e8. */
	rateSatsPerPusdScaled: bigint;
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
	if (state.rateSatsPerPusdScaled <= 0n || state.rateSatsPerPusdScaled > MAX_INT64) {
		throw new Error('Oracle rate must be positive and fit a signed 64-bit integer.');
	}
	for (const [label, value] of [
		['timestamp', state.timestamp],
		['sequence', state.sequence]
	] as const) {
		if (!Number.isSafeInteger(value) || value < 0 || value > MAX_INT32) {
			throw new Error(`Oracle ${label} must fit a positive signed 32-bit integer.`);
		}
	}
	return concat([
		intLE(state.rateSatsPerPusdScaled, 8),
		intLE(BigInt(state.timestamp), 4),
		intLE(BigInt(state.sequence), 4)
	]);
}

export function decodeOracleCommitment(commitment: Uint8Array): OracleState {
	if (commitment.length !== ORACLE_COMMITMENT_BYTES) {
		throw new Error('Oracle commitment must be 16 bytes.');
	}
	const rate = readLE(commitment.slice(0, 8));
	const timestamp = Number(readLE(commitment.slice(8, 12)));
	const sequence = Number(readLE(commitment.slice(12, 16)));
	if (rate <= 0n || rate > MAX_INT64 || timestamp > MAX_INT32 || sequence > MAX_INT32) {
		throw new Error('Oracle commitment contains an invalid field.');
	}
	return { rateSatsPerPusdScaled: rate, timestamp, sequence };
}

export function makerPkhFromPublicKey(publicKey: Uint8Array): string {
	return binToHex(hash160(publicKey));
}

/**
 * Exact covenant settlement inequality, mirrored off-chain.
 * Returns true when the contract's fill check would pass for these deltas.
 */
export function settlementSatisfied(
	dSat: bigint,
	dUnits: bigint,
	oracleRate: bigint,
	deltaBps: number
): boolean {
	return dSat * SETTLEMENT_SCALE + dUnits * oracleRate * (10_000n + BigInt(deltaBps)) >= 0n;
}

/** Minimum BCH a taker must add to a sell order for `units` PUSD (rounded up). */
export function sellFillPaymentSats(units: bigint, oracleRate: bigint, deltaBps: number): bigint {
	if (units <= 0n) throw new Error('Fill quantity must be positive.');
	const numerator = units * oracleRate * (10_000n + BigInt(deltaBps));
	return (numerator + SETTLEMENT_SCALE - 1n) / SETTLEMENT_SCALE;
}

/** Maximum BCH a taker may remove from a buy order for `units` PUSD (rounded down). */
export function buyFillTakeSats(units: bigint, oracleRate: bigint, deltaBps: number): bigint {
	if (units <= 0n) throw new Error('Fill quantity must be positive.');
	return (units * oracleRate * (10_000n + BigInt(deltaBps))) / SETTLEMENT_SCALE;
}

export const contractArtifacts = {
	order: { name: orderArtifact.contractName, compiler: orderArtifact.compiler },
	oracle: { name: oracleArtifact.contractName, compiler: oracleArtifact.compiler }
};
