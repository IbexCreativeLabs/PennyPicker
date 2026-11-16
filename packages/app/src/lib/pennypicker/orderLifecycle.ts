import { MAX_TOKEN_UNITS } from './market';

export type OrderPhase =
	| 'draft'
	| 'unsigned'
	| 'signed'
	| 'broadcast'
	| 'created'
	| 'discovered'
	| 'matched'
	| 'partially-filled'
	| 'filled'
	| 'canceled';

export type OrderTransactionPurpose = 'create' | 'fill' | 'cancel';
export type OrderTransactionStage = 'unsigned' | 'signed' | 'broadcast' | 'confirmed' | 'rejected';

export interface OrderTransactionRecord {
	purpose: OrderTransactionPurpose;
	stage: OrderTransactionStage;
	unsignedTransactionHash: string;
	signedTransactionId?: string;
	broadcastTransactionId?: string;
	confirmationHeight?: number;
	fillQuantityUnits?: bigint;
}

export type OrderLifecycleEvent =
	| { type: 'drafted'; atMs: number }
	| { type: 'transaction-unsigned'; purpose: OrderTransactionPurpose; hash: string; atMs: number }
	| { type: 'wallet-approved'; purpose: OrderTransactionPurpose; txid: string; atMs: number }
	| { type: 'wallet-rejected'; purpose: OrderTransactionPurpose; atMs: number }
	| { type: 'broadcast'; purpose: OrderTransactionPurpose; txid: string; atMs: number }
	| {
			type: 'confirmed';
			purpose: OrderTransactionPurpose;
			txid: string;
			height: number;
			atMs: number;
	  }
	| { type: 'discovered'; txid: string; vout: number; height: number; atMs: number }
	| { type: 'matched'; quantityUnits: bigint; atMs: number }
	| { type: 'fill-accounted'; quantityUnits: bigint; remainingUnits: bigint; atMs: number }
	| { type: 'canceled'; txid: string; atMs: number };

export interface PennyPickerOrderLifecycle {
	orderId: string;
	quantityUnits: bigint;
	remainingUnits: bigint;
	phase: OrderPhase;
	matchedQuantityUnits?: bigint;
	currentOutpoint?: { txid: string; vout: number; height: number };
	pendingTransaction?: OrderTransactionRecord & { resumePhase: OrderPhase };
	transactions: OrderTransactionRecord[];
	events: OrderLifecycleEvent[];
}

function assertTxid(value: string, label: string): string {
	const normalized = value.toLowerCase();
	if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error(`${label} must be 32-byte hex.`);
	return normalized;
}

function append(
	order: PennyPickerOrderLifecycle,
	event: OrderLifecycleEvent,
	updates: Partial<PennyPickerOrderLifecycle>
): PennyPickerOrderLifecycle {
	return { ...order, ...updates, events: [...order.events, event] };
}

export function createOrderLifecycle(
	orderId: string,
	quantityUnits: bigint
): PennyPickerOrderLifecycle {
	if (!orderId.trim()) throw new Error('Order ID is required.');
	if (quantityUnits <= 0n || quantityUnits > MAX_TOKEN_UNITS) {
		throw new Error('Order quantity must fit the positive CashToken amount range.');
	}
	return {
		orderId,
		quantityUnits,
		remainingUnits: quantityUnits,
		phase: 'draft',
		transactions: [],
		events: [{ type: 'drafted', atMs: Date.now() }]
	};
}

function beginTransaction(
	order: PennyPickerOrderLifecycle,
	purpose: OrderTransactionPurpose,
	unsignedTransactionHash: string,
	resumePhase: OrderPhase,
	fillQuantityUnits?: bigint
): PennyPickerOrderLifecycle {
	if (order.pendingTransaction) throw new Error('An order transaction is already in progress.');
	const hash = assertTxid(unsignedTransactionHash, 'Unsigned transaction hash');
	const transaction: OrderTransactionRecord & { resumePhase: OrderPhase } = {
		purpose,
		stage: 'unsigned',
		unsignedTransactionHash: hash,
		resumePhase,
		...(fillQuantityUnits === undefined ? {} : { fillQuantityUnits })
	};
	return append(
		order,
		{ type: 'transaction-unsigned', purpose, hash, atMs: Date.now() },
		{ phase: 'unsigned', pendingTransaction: transaction }
	);
}

export function prepareOrderCreation(
	order: PennyPickerOrderLifecycle,
	unsignedTransactionHash: string
): PennyPickerOrderLifecycle {
	if (order.phase !== 'draft') throw new Error('Only a draft order can be created.');
	return beginTransaction(order, 'create', unsignedTransactionHash, 'draft');
}

export function proposeOrderFill(
	order: PennyPickerOrderLifecycle,
	quantityUnits: bigint
): PennyPickerOrderLifecycle {
	if (order.phase !== 'discovered') throw new Error('Only a discovered order can be matched.');
	if (quantityUnits <= 0n || quantityUnits > order.remainingUnits) {
		throw new Error('Matched quantity exceeds the open order quantity.');
	}
	return append(
		order,
		{ type: 'matched', quantityUnits, atMs: Date.now() },
		{
			phase: 'matched',
			matchedQuantityUnits: quantityUnits
		}
	);
}

export function prepareOrderFill(
	order: PennyPickerOrderLifecycle,
	unsignedTransactionHash: string
): PennyPickerOrderLifecycle {
	if (order.phase !== 'matched' || order.matchedQuantityUnits === undefined) {
		throw new Error('A fill transaction requires a matched order quantity.');
	}
	return beginTransaction(
		order,
		'fill',
		unsignedTransactionHash,
		'matched',
		order.matchedQuantityUnits
	);
}

export function prepareOrderCancellation(
	order: PennyPickerOrderLifecycle,
	unsignedTransactionHash: string
): PennyPickerOrderLifecycle {
	if (order.phase !== 'discovered' || !order.currentOutpoint) {
		throw new Error('Cancellation requires a currently discovered open order.');
	}
	return beginTransaction(order, 'cancel', unsignedTransactionHash, order.phase);
}

export function recordWalletApproval(
	order: PennyPickerOrderLifecycle,
	signedTransactionId: string
): PennyPickerOrderLifecycle {
	const pending = order.pendingTransaction;
	if (!pending || pending.stage !== 'unsigned')
		throw new Error('No unsigned transaction is awaiting approval.');
	const txid = assertTxid(signedTransactionId, 'Signed transaction ID');
	const next = { ...pending, stage: 'signed' as const, signedTransactionId: txid };
	return append(
		order,
		{ type: 'wallet-approved', purpose: pending.purpose, txid, atMs: Date.now() },
		{
			phase: 'signed',
			pendingTransaction: next
		}
	);
}

export function recordWalletRejection(order: PennyPickerOrderLifecycle): PennyPickerOrderLifecycle {
	const pending = order.pendingTransaction;
	if (!pending || pending.stage !== 'unsigned')
		throw new Error('No unsigned transaction can be rejected.');
	const { resumePhase, ...transaction } = pending;
	return append(
		order,
		{ type: 'wallet-rejected', purpose: pending.purpose, atMs: Date.now() },
		{
			phase: resumePhase,
			pendingTransaction: undefined,
			matchedQuantityUnits:
				pending.purpose === 'fill' ? pending.fillQuantityUnits : order.matchedQuantityUnits,
			transactions: [...order.transactions, { ...transaction, stage: 'rejected' }]
		}
	);
}

export function recordOrderBroadcast(
	order: PennyPickerOrderLifecycle,
	broadcastTransactionId: string
): PennyPickerOrderLifecycle {
	const pending = order.pendingTransaction;
	if (!pending || pending.stage !== 'signed' || !pending.signedTransactionId) {
		throw new Error('Cashonize must sign the transaction before broadcast.');
	}
	const txid = assertTxid(broadcastTransactionId, 'Broadcast transaction ID');
	if (txid !== pending.signedTransactionId)
		throw new Error('Broadcast ID differs from the signed transaction.');
	const next = { ...pending, stage: 'broadcast' as const, broadcastTransactionId: txid };
	return append(
		order,
		{ type: 'broadcast', purpose: pending.purpose, txid, atMs: Date.now() },
		{
			phase: 'broadcast',
			pendingTransaction: next
		}
	);
}

export function recordOrderConfirmation(
	order: PennyPickerOrderLifecycle,
	transactionId: string,
	height: number
): PennyPickerOrderLifecycle {
	const pending = order.pendingTransaction;
	if (!pending || pending.stage !== 'broadcast' || !pending.broadcastTransactionId) {
		throw new Error('Only a broadcast transaction can be confirmed.');
	}
	const txid = assertTxid(transactionId, 'Confirmed transaction ID');
	if (txid !== pending.broadcastTransactionId)
		throw new Error('Confirmation ID differs from the broadcast transaction.');
	if (!Number.isSafeInteger(height) || height <= 0)
		throw new Error('Confirmation height must be positive.');
	const { resumePhase: _resumePhase, ...transaction } = pending;
	const transactions = [
		...order.transactions,
		{ ...transaction, stage: 'confirmed' as const, confirmationHeight: height }
	];
	const base = {
		pendingTransaction: undefined,
		transactions
	};
	if (pending.purpose === 'create') {
		return append(
			order,
			{ type: 'confirmed', purpose: 'create', txid, height, atMs: Date.now() },
			{
				...base,
				phase: 'created'
			}
		);
	}
	if (pending.purpose === 'cancel') {
		const confirmedAt = Date.now();
		return {
			...order,
			events: [
				...order.events,
				{ type: 'confirmed', purpose: 'cancel', txid, height, atMs: confirmedAt },
				{ type: 'canceled', txid, atMs: confirmedAt }
			],
			...base,
			phase: 'canceled',
			currentOutpoint: undefined,
			matchedQuantityUnits: undefined
		};
	}
	const fillQuantity = pending.fillQuantityUnits;
	if (fillQuantity === undefined || fillQuantity <= 0n || fillQuantity > order.remainingUnits) {
		throw new Error('Confirmed fill quantity is invalid for the remaining order.');
	}
	const remainingUnits = order.remainingUnits - fillQuantity;
	const confirmedAt = Date.now();
	return {
		...order,
		events: [
			...order.events,
			{ type: 'confirmed', purpose: 'fill', txid, height, atMs: confirmedAt },
			{ type: 'fill-accounted', quantityUnits: fillQuantity, remainingUnits, atMs: confirmedAt }
		],
		...base,
		phase: remainingUnits === 0n ? 'filled' : 'partially-filled',
		remainingUnits,
		matchedQuantityUnits: undefined,
		currentOutpoint: undefined
	};
}

export function recordOrderDiscovered(
	order: PennyPickerOrderLifecycle,
	txid: string,
	vout: number,
	height: number
): PennyPickerOrderLifecycle {
	if (!['created', 'partially-filled'].includes(order.phase)) {
		throw new Error('Only a confirmed open order can be discovered.');
	}
	if (!Number.isSafeInteger(vout) || vout < 0)
		throw new Error('Discovered output index is invalid.');
	if (vout % 2 !== 0) throw new Error('Order thread must use an even output index.');
	if (!Number.isSafeInteger(height) || height <= 0) {
		throw new Error('Order discovery requires a confirmed output height.');
	}
	const normalizedTxid = assertTxid(txid, 'Discovered transaction ID');
	const expectedPurpose = order.phase === 'created' ? 'create' : 'fill';
	const latestConfirmation = [...order.transactions]
		.reverse()
		.find((transaction) => transaction.purpose === expectedPurpose);
	if (!latestConfirmation?.broadcastTransactionId || !latestConfirmation.confirmationHeight) {
		throw new Error('No matching confirmed transaction is available for discovery.');
	}
	if (
		normalizedTxid !== latestConfirmation.broadcastTransactionId ||
		height !== latestConfirmation.confirmationHeight
	) {
		throw new Error('Discovered output does not match the latest confirmed order transaction.');
	}
	return append(
		order,
		{
			type: 'discovered',
			txid: normalizedTxid,
			vout,
			height,
			atMs: Date.now()
		},
		{
			phase: 'discovered',
			currentOutpoint: { txid: normalizedTxid, vout, height }
		}
	);
}
