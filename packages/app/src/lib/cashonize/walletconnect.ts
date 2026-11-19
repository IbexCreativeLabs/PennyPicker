import type SignClient from '@walletconnect/sign-client';

export const CHIPNET_CHAIN = 'bch:bchtest';
export const MAINNET_CHAIN = 'bch:bitcoincash';
export type BchChain = typeof CHIPNET_CHAIN | typeof MAINNET_CHAIN;

const chainLabel = (chain: BchChain) => (chain === MAINNET_CHAIN ? 'BCH mainnet' : 'BCH Chipnet');
const chainPrefix = (chain: BchChain) => (chain === MAINNET_CHAIN ? 'bitcoincash:' : 'bchtest:');

const BCH_METHODS = ['bch_getAddresses', 'bch_signTransaction'];
const BCH_EVENTS = ['addressesChanged'];

export type CashonizeClient = SignClient;
export type CashonizeSession = ReturnType<CashonizeClient['session']['getAll']>[number];

let clientPromise: Promise<CashonizeClient> | undefined;

async function initializeCashonizeClient(): Promise<CashonizeClient> {
	const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();
	if (!projectId || projectId === 'YOUR_WALLETCONNECT_PROJECT_ID') {
		throw new Error(
			'Configure VITE_WALLETCONNECT_PROJECT_ID in packages/app/.env before connecting.'
		);
	}

	// Load the browser client only after the user chooses to connect. This keeps the
	// WalletConnect client out of server rendering and wallet initialization.
	const { default: SignClient } = await import('@walletconnect/sign-client');
	return SignClient.init({
		projectId,
		metadata: {
			name: 'PennyPicker',
			description: 'PennyPicker: oracle-relative BCH/stablecoin orderbook',
			url: window.location.origin,
			icons: [new URL('/pennypicker-192.png', window.location.origin).toString()]
		}
	});
}

export function createCashonizeClient(): Promise<CashonizeClient> {
	clientPromise ??= initializeCashonizeClient().catch((error) => {
		clientPromise = undefined;
		throw error;
	});
	return clientPromise;
}

export function getApprovedSession(client: CashonizeClient, chain: BchChain): CashonizeSession | undefined {
	return client.session
		.getAll()
		.find((session) => {
			const namespace = session.namespaces.bch;
			return namespace?.chains?.includes(chain) === true &&
				namespace.methods.includes('bch_signTransaction');
		});
}

export function getApprovedChipnetSession(client: CashonizeClient): CashonizeSession | undefined {
	return getApprovedSession(client, CHIPNET_CHAIN);
}

export function requestCashonizeSession(client: CashonizeClient, chain: BchChain) {
	return client.connect({
		requiredNamespaces: {
			bch: {
				chains: [chain],
				methods: BCH_METHODS,
				events: BCH_EVENTS
			}
		}
	});
}

export function requestCashonizeChipnetSession(client: CashonizeClient) {
	return requestCashonizeSession(client, CHIPNET_CHAIN);
}

export function requestChipnetAddresses(client: CashonizeClient, session: CashonizeSession): Promise<string[]> {
	return requestAddresses(client, session, CHIPNET_CHAIN);
}

export async function requestAddresses(
	client: CashonizeClient,
	session: CashonizeSession,
	chain: BchChain
): Promise<string[]> {
	const bchNamespace = session.namespaces.bch;
	if (!bchNamespace?.chains?.includes(chain)) {
		throw new Error(`Cashonize did not approve a ${chainLabel(chain)} session.`);
	}
	if (!bchNamespace.methods.includes('bch_getAddresses')) {
		throw new Error('The session does not permit BCH address requests.');
	}

	const addresses = await client.request<string[]>({
		topic: session.topic,
		chainId: chain,
		request: {
			method: 'bch_getAddresses',
			params: {}
		}
	});
	const onChain = addresses.filter((address) => address.startsWith(chainPrefix(chain)));
	if (onChain.length === 0) {
		throw new Error(`Cashonize returned no ${chainLabel(chain)} address.`);
	}
	return onChain;
}

export async function requestCashonizeTransactionSignature(
	client: CashonizeClient,
	session: CashonizeSession,
	unsignedTransaction: string,
	sourceOutputs: unknown,
	userPrompt = 'Review the PennyPicker transaction before signing.',
	chain: BchChain = CHIPNET_CHAIN
): Promise<{ signedTransaction: string; signedTransactionHash: string }> {
	const namespace = session.namespaces.bch;
	if (!namespace?.chains?.includes(chain) || !namespace.methods.includes('bch_signTransaction')) {
		throw new Error(`The active session does not allow ${chainLabel(chain)} transaction signing.`);
	}
	const response = await client.request<{ signedTransaction?: string; signedTransactionHash?: string }>({
		topic: session.topic,
		chainId: chain,
		request: {
			method: 'bch_signTransaction',
			params: {
				transaction: unsignedTransaction,
				sourceOutputs,
				broadcast: false,
				userPrompt
			}
		}
	});
	if (!response.signedTransaction || !response.signedTransactionHash) {
		throw new Error('Cashonize did not return a signed transaction and transaction hash.');
	}
	return {
		signedTransaction: response.signedTransaction,
		signedTransactionHash: response.signedTransactionHash
	};
}

export async function disconnectCashonizeSession(
	client: CashonizeClient,
	session: CashonizeSession
): Promise<void> {
	await client.disconnect({
		topic: session.topic,
		reason: { code: 6000, message: 'User disconnected.' }
	});
}

export function describeWalletConnectError(error: unknown): string {
	const reason = error as { code?: number; message?: string };
	if (reason?.code === 5000 || /user rejected|user denied|rejected/i.test(reason?.message ?? '')) {
		return 'Cashonize rejected the connection request.';
	}
	return reason?.message || 'WalletConnect could not connect to Cashonize.';
}
