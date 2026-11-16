/**
 * Plain-language explanations for WalletConnect signing failures and Chipnet
 * broadcast rejections. Pure functions, so they can be unit tested.
 */

const text = (cause: unknown) => {
	if (cause instanceof Error) return cause.message;
	if (typeof cause === 'object' && cause && 'message' in cause) return String((cause as { message: unknown }).message);
	return String(cause);
};

export function describeSignError(cause: unknown): string {
	const code = (cause as { code?: number })?.code;
	const message = text(cause);
	if (code === 5000 || code === 4001 || /user rejected|user denied|rejected|cancel/i.test(message)) {
		return 'You declined the signature in Cashonize. Nothing was signed or broadcast.';
	}
	if (/expired|no matching key|session.*(not found|deleted)|missing or invalid.*topic/i.test(message)) {
		return 'The WalletConnect session has ended. Reconnect Cashonize on the Wallet page, then review the transaction again.';
	}
	if (/timeout|timed out/i.test(message)) {
		return 'Cashonize did not answer in time. Open Cashonize (Chipnet), check for a pending request, and try again.';
	}
	if (/does not match|different|preview/i.test(message)) {
		return `Signed transaction rejected by PennyPicker: ${message} It was not broadcast.`;
	}
	return `Cashonize could not sign: ${message}`;
}

export function describeBroadcastError(cause: unknown): string {
	const message = text(cause);
	if (/missing ?inputs|missingorspent|inputs-missing|txn-mempool-conflict|conflict/i.test(message)) {
		return 'An input was already spent, usually because someone else used the oracle or this order first. Discard this transaction, refresh, and build it again. Nothing was broadcast.';
	}
	if (/min relay fee|insufficient fee|fee not met/i.test(message)) {
		return `The network fee was too low (${message}). Nothing was broadcast.`;
	}
	if (/script|verify|mandatory|non-mandatory|evaluat/i.test(message)) {
		return `The covenant rejected this transaction (${message}). Nothing was broadcast. Please send this through Feedback.`;
	}
	if (/already (in|known)|txn-already/i.test(message)) {
		return 'Chipnet already has this transaction.';
	}
	if (/unreachable|connect|socket|network|timeout/i.test(message)) {
		return `Could not reach the Chipnet server (${message}). The signed transaction is kept here; try Broadcast again.`;
	}
	return `Chipnet rejected the transaction: ${message}`;
}
