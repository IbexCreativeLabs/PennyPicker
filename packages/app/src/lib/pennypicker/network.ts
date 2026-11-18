/**
 * Networks PennyPicker knows about. Contracts and transaction formats are the
 * same on both; only addresses, the Electrum servers, the WalletConnect chain
 * and explorers differ.
 */
import { decodeCashAddress } from '@bitauth/libauth';

export type NetworkId = 'chipnet' | 'mainnet';

export interface NetworkInfo {
	id: NetworkId;
	label: string;
	/** CashAddress prefix. */
	prefix: 'bchtest' | 'bitcoincash';
	/** WalletConnect (CAIP-2) chain id understood by Cashonize. */
	walletConnectChain: 'bch:bchtest' | 'bch:bitcoincash';
	explorerTx: (txid: string) => string;
	explorerAddress: (address: string) => string;
	/** localStorage namespace for per-network state. */
	storagePrefix: string;
	/** Real money: show warnings, apply the order cap, gate broadcasting. */
	realFunds: boolean;
}

export const NETWORKS: Record<NetworkId, NetworkInfo> = {
	chipnet: {
		id: 'chipnet',
		label: 'Chipnet',
		prefix: 'bchtest',
		walletConnectChain: 'bch:bchtest',
		explorerTx: (txid) => `https://chipnet.imaginary.cash/tx/${txid}`,
		explorerAddress: (address) => `https://chipnet.imaginary.cash/address/${address}`,
		storagePrefix: 'pennypicker:chipnet:',
		realFunds: false
	},
	mainnet: {
		id: 'mainnet',
		label: 'Mainnet',
		prefix: 'bitcoincash',
		walletConnectChain: 'bch:bitcoincash',
		explorerTx: (txid) => `https://bchexplorer.cash/tx/${txid}`,
		explorerAddress: (address) => `https://bchexplorer.cash/address/${address}`,
		storagePrefix: 'pennypicker:mainnet:',
		realFunds: true
	}
};

/** Network of a prefixed CashAddress; undefined for anything else. */
export function networkOfAddress(address: string): NetworkId | undefined {
	const decoded = decodeCashAddress(address.trim());
	if (typeof decoded === 'string') return undefined;
	return (Object.values(NETWORKS).find((network) => network.prefix === decoded.prefix) ?? undefined)?.id;
}

export function assertAddressOnNetwork(address: string, network: NetworkId): void {
	if (networkOfAddress(address) !== network) {
		throw new Error(`Expected a BCH ${NETWORKS[network].label} address (${NETWORKS[network].prefix}:…).`);
	}
}
