import { assertSideDelta, type OrderSide } from './market';

/** CashTokens caps fungible token amounts at signed int64 max. */
export const MAX_TOKEN_UNITS = (1n << 63n) - 1n;
export const BPS_ORDER_COMMITMENT_VERSION = 1;
export const BPS_ORDER_COMMITMENT_BYTES = 14;

/**
 * Compact proposed commitment layout for a mutable order NFT:
 * version:u8 | side:u8 | remaining token units:u64le | delta BPS:i32le.
 * The BPS delta is applied to a freshly authenticated BCH/PUSD observation at
 * execution. This format is not compatible with, or enforced by, current CatDex.
 */
export interface BpsOrderCommitment {
	side: OrderSide;
	remainingUnits: bigint;
	deltaBps: number;
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

export function encodeBpsOrderCommitment(order: BpsOrderCommitment): Uint8Array {
	assertSideDelta(order.side, order.deltaBps);
	if (order.remainingUnits < 0n || order.remainingUnits > MAX_TOKEN_UNITS) {
		throw new Error('Remaining order quantity is outside the CashToken amount range.');
	}
	const result = new Uint8Array(BPS_ORDER_COMMITMENT_BYTES);
	result[0] = BPS_ORDER_COMMITMENT_VERSION;
	result[1] = order.side === 'buy-pusd' ? 0 : 1;
	result.set(encodeUint64LE(order.remainingUnits), 2);
	result.set(encodeInt32LE(order.deltaBps), 10);
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
		deltaBps: decodeInt32LE(commitment.slice(10, 14))
	};
	assertSideDelta(order.side, order.deltaBps);
	if (order.remainingUnits > MAX_TOKEN_UNITS) {
		throw new Error('Remaining order quantity exceeds the CashToken amount range.');
	}
	return order;
}
