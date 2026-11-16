import { assertSideDelta, MAX_TOKEN_UNITS, type OrderSide } from './market';
import { binToHex, cashAddressToLockingBytecode } from '@bitauth/libauth';
export { MAX_TOKEN_UNITS };

export const BPS_ORDER_COMMITMENT_VERSION = 2;
export const BPS_ORDER_COMMITMENT_BYTES = 34;

/**
 * Proposed mutable-order NFT layout:
 * version:u8 | side:u8 | remaining token units:u64le | delta BPS:i32le |
 * maker P2PKH hash:20 bytes.
 * Maker hash is the 20-byte HASH160 in locking-bytecode/display hex order and
 * lets a covenant authorize cancellation without a per-maker script hash. The
 * BPS delta is applied to a freshly authenticated BCH/PUSD observation at fill.
 * This format is not compatible with, or enforced by, current CatDex.
 */
export interface BpsOrderCommitment {
	side: OrderSide;
	remainingUnits: bigint;
	deltaBps: number;
	/** 20-byte P2PKH HASH160, lowercase or uppercase hex. */
	makerPkh: string;
}

function encodeUint64LE(value: bigint): Uint8Array {
	const result = new Uint8Array(8);
	for (let index = 0; index < result.length; index++) {
		result[index] = Number((value >> BigInt(index * 8)) & 0xffn);
	}
	return result;
}

function decodeUint64LE(value: Uint8Array): bigint {
	let result = 0n;
	for (let index = value.length - 1; index >= 0; index--) {
		result = (result << 8n) | BigInt(value[index]!);
	}
	return result;
}

function encodeInt32LE(value: number): Uint8Array {
	const encoded = BigInt.asUintN(32, BigInt(value));
	const result = new Uint8Array(4);
	for (let index = 0; index < result.length; index++) {
		result[index] = Number((encoded >> BigInt(index * 8)) & 0xffn);
	}
	return result;
}

function decodeInt32LE(value: Uint8Array): number {
	let unsigned = 0n;
	for (let index = value.length - 1; index >= 0; index--) {
		unsigned = (unsigned << 8n) | BigInt(value[index]!);
	}
	return Number(BigInt.asIntN(32, unsigned));
}

function validateMakerPkh(makerPkh: string): string {
	const normalized = makerPkh.toLowerCase();
	if (!/^[0-9a-f]{40}$/.test(normalized)) {
		throw new Error('Maker public-key hash must be 20-byte hex.');
	}
	if (/^0{40}$/.test(normalized)) {
		throw new Error('Maker public-key hash cannot be all zeroes.');
	}
	return normalized;
}

/** Extract the maker hash from a public Cashonize Chipnet P2PKH address. */
export function makerPkhFromChipnetAddress(address: string): string {
	if (!address.startsWith('bchtest:')) {
		throw new Error('Maker address must be a prefixed BCH Chipnet address.');
	}
	const decoded = cashAddressToLockingBytecode(address);
	if (typeof decoded === 'string') throw new Error(`Invalid maker address: ${decoded}`);
	const bytecode = decoded.bytecode;
	if (
		bytecode.length !== 25 ||
		bytecode[0] !== 0x76 ||
		bytecode[1] !== 0xa9 ||
		bytecode[2] !== 0x14 ||
		bytecode[23] !== 0x88 ||
		bytecode[24] !== 0xac
	) {
		throw new Error('Maker address must be a P2PKH address; P2SH addresses are not supported.');
	}
	return validateMakerPkh(binToHex(bytecode.slice(3, 23)));
}

export function encodeBpsOrderCommitment(order: BpsOrderCommitment): Uint8Array {
	assertSideDelta(order.side, order.deltaBps);
	if (order.remainingUnits < 0n || order.remainingUnits > MAX_TOKEN_UNITS) {
		throw new Error('Remaining order quantity is outside the CashToken amount range.');
	}
	const makerPkh = validateMakerPkh(order.makerPkh);
	const result = new Uint8Array(BPS_ORDER_COMMITMENT_BYTES);
	result[0] = BPS_ORDER_COMMITMENT_VERSION;
	result[1] = order.side === 'buy-pusd' ? 0 : 1;
	result.set(encodeUint64LE(order.remainingUnits), 2);
	result.set(encodeInt32LE(order.deltaBps), 10);
	for (let index = 0; index < 20; index++) {
		result[14 + index] = Number.parseInt(makerPkh.slice(index * 2, index * 2 + 2), 16);
	}
	return result;
}

export function decodeBpsOrderCommitment(commitment: Uint8Array): BpsOrderCommitment {
	if (commitment.length !== BPS_ORDER_COMMITMENT_BYTES) {
		throw new Error(`BPS order commitment must be exactly ${BPS_ORDER_COMMITMENT_BYTES} bytes.`);
	}
	if (commitment[0] !== BPS_ORDER_COMMITMENT_VERSION) {
		throw new Error('Unsupported BPS order commitment version.');
	}
	const sideByte = commitment[1];
	if (sideByte !== 0 && sideByte !== 1) throw new Error('Invalid BPS order side.');
	const order = {
		side: sideByte === 0 ? ('buy-pusd' as const) : ('sell-pusd' as const),
		remainingUnits: decodeUint64LE(commitment.slice(2, 10)),
		deltaBps: decodeInt32LE(commitment.slice(10, 14)),
		makerPkh: Array.from(commitment.slice(14, 34), (byte) => byte.toString(16).padStart(2, '0')).join('')
	};
	assertSideDelta(order.side, order.deltaBps);
	validateMakerPkh(order.makerPkh);
	if (order.remainingUnits > MAX_TOKEN_UNITS) {
		throw new Error('Remaining order quantity exceeds the CashToken amount range.');
	}
	return order;
}
