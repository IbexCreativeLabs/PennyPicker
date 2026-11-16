/**
 * Chipnet I/O for the PennyPicker exchange: market configuration, oracle state,
 * order discovery and broadcasting. Reads use the app's Electrum Chipnet
 * provider; broadcasting is only ever called from an explicit user action.
 */
import { binToHex, decodeTransaction, hexToBin } from '@bitauth/libauth';
import { TestNetWatchWallet } from '@unspent/wallet';
import { oracleContract } from './contracts';
import {
	contractAddress,
	describeOrder,
	findOracleUtxo,
	parseAnnouncement,
	toOpenOrder,
	type AnnouncedOrder,
	type ChainUtxo,
	type MarketConfig,
	type OpenOrder,
	type OracleUtxo
} from './exchange';
import { PUSD_CATEGORY_STORAGE_KEY } from './pusdGenesis';

export const ORACLE_CATEGORY_STORAGE_KEY = 'pennypicker:chipnet:oracle-category';
export const ORACLE_OPERATOR_STORAGE_KEY = 'pennypicker:chipnet:oracle-operator-pkh';
export const TX_HISTORY_STORAGE_KEY = 'pennypicker:chipnet:tx-history';
/** Most recent oracle-address transactions scanned for order announcements. */
export const DISCOVERY_HISTORY_LIMIT = 300;

const hex32 = /^[0-9a-f]{64}$/;
const hex20 = /^[0-9a-f]{40}$/;

function readStorage(key: string): string {
	try {
		return (globalThis.localStorage?.getItem(key) ?? '').trim().toLowerCase();
	} catch {
		return '';
	}
}

export function writeStorage(key: string, value: string): void {
	try {
		globalThis.localStorage?.setItem(key, value);
	} catch {
		/* storage unavailable: configuration stays in memory for this session */
	}
}

/**
 * Market identity: environment variables (shared deployment) take precedence
 * over values stored locally after this browser ran a genesis.
 */
export function loadMarketConfig(): Partial<MarketConfig> & { source: Record<string, 'env' | 'local' | 'missing'> } {
	const env = import.meta.env ?? {};
	const pick = (envKey: string, storageKey: string, pattern: RegExp) => {
		const fromEnv = String(env[envKey] ?? '').trim().toLowerCase();
		if (pattern.test(fromEnv)) return { value: fromEnv, source: 'env' as const };
		const local = readStorage(storageKey);
		if (pattern.test(local)) return { value: local, source: 'local' as const };
		return { value: undefined, source: 'missing' as const };
	};
	const pusd = pick('VITE_PENNYPICKER_PUSD_CATEGORY', PUSD_CATEGORY_STORAGE_KEY, hex32);
	const oracle = pick('VITE_PENNYPICKER_ORACLE_CATEGORY', ORACLE_CATEGORY_STORAGE_KEY, hex32);
	const operator = pick('VITE_PENNYPICKER_ORACLE_OPERATOR_PKH', ORACLE_OPERATOR_STORAGE_KEY, hex20);
	return {
		pusdCategory: pusd.value,
		oracleCategory: oracle.value,
		oracleOperatorPkh: operator.value,
		source: { pusdCategory: pusd.source, oracleCategory: oracle.source, oracleOperatorPkh: operator.source }
	};
}

export function isCompleteMarket(config: Partial<MarketConfig>): config is MarketConfig {
	return !!config.pusdCategory && !!config.oracleCategory && !!config.oracleOperatorPkh;
}

export function oracleAddress(operatorPkh: string): string {
	return contractAddress(oracleContract({ operatorPkh }));
}

type Provider = Awaited<ReturnType<typeof TestNetWatchWallet.watchOnly>>['provider'];
let providerPromise: Promise<Provider> | undefined;

/** Shared Electrum Chipnet provider (via the wallet package's testnet network). */
export function chipnetProvider(anyAddress: string): Promise<Provider> {
	providerPromise ??= TestNetWatchWallet.watchOnly(anyAddress)
		.then((wallet) => wallet.provider)
		.catch((cause) => {
			// Do not cache a failed connection; the next refresh retries.
			providerPromise = undefined;
			throw cause;
		});
	return providerPromise;
}

export async function getAddressUtxos(address: string): Promise<ChainUtxo[]> {
	const provider = await chipnetProvider(address);
	const utxos = await provider.getUtxos(address);
	return utxos.map((utxo) => ({
		txid: utxo.txid,
		vout: utxo.vout,
		satoshis: utxo.satoshis,
		height: utxo.height,
		...(utxo.token
			? {
					token: {
						category: utxo.token.category,
						amount: utxo.token.amount,
						...(utxo.token.nft
							? { nft: { capability: utxo.token.nft.capability, commitment: utxo.token.nft.commitment ?? '' } }
							: {})
					}
				}
			: {})
	}));
}

/** Number of transactions Electrum has ever indexed for this address (confirmed + mempool). */
export async function getAddressHistoryCount(address: string): Promise<number> {
	const provider = await chipnetProvider(address);
	return (await provider.getHistory(address)).length;
}

export async function getOracleState(market: MarketConfig): Promise<OracleUtxo | undefined> {
	return findOracleUtxo(await getAddressUtxos(oracleAddress(market.oracleOperatorPkh)), market);
}

export interface DiscoveryResult {
	orders: OpenOrder[];
	/** Announced orders whose UTXOs are spent (canceled) or not yet visible. */
	closed: AnnouncedOrder[];
	scannedTransactions: number;
	historyTruncated: boolean;
}

/**
 * Discover orders: every order-creation transaction reads the oracle, so it is
 * in the oracle address history. Announcements are re-derived into contract
 * addresses (a forged announcement cannot point at a different script), then
 * each address is queried for its live UTXO.
 */
export async function discoverOrders(market: MarketConfig): Promise<DiscoveryResult> {
	const address = oracleAddress(market.oracleOperatorPkh);
	const provider = await chipnetProvider(address);
	const history = await provider.getHistory(address);
	const recent = history.slice(-DISCOVERY_HISTORY_LIMIT);
	const announced = new Map<string, AnnouncedOrder>();
	await inBatches(recent, 10, async (entry) => {
		const raw = await provider.getRawTransaction(entry.tx_hash);
		const decoded = decodeTransaction(hexToBin(raw));
		if (typeof decoded === 'string') return;
		for (const output of decoded.outputs) {
			const parsed = parseAnnouncement(output.lockingBytecode);
			if (!parsed) continue;
			const order = describeOrder(market, parsed);
			const created = decoded.outputs.some((candidate) => binToHex(candidate.lockingBytecode) === order.lockingBytecodeHex);
			if (created && !announced.has(order.lockingBytecodeHex)) {
				announced.set(order.lockingBytecodeHex, { ...order, createdTxid: entry.tx_hash });
			}
		}
	});
	const orders: OpenOrder[] = [];
	const closed: AnnouncedOrder[] = [];
	await inBatches([...announced.values()], 10, async (order) => {
		const utxos = await provider.getUtxos(order.address);
		const live = utxos
			.map((utxo) => toOpenOrder(order, {
				txid: utxo.txid,
				vout: utxo.vout,
				satoshis: utxo.satoshis,
				height: utxo.height,
				...(utxo.token ? { token: { category: utxo.token.category, amount: utxo.token.amount, ...(utxo.token.nft ? { nft: { capability: utxo.token.nft.capability, commitment: utxo.token.nft.commitment ?? '' } } : {}) } } : {})
			}, market))
			.filter((entry): entry is OpenOrder => !!entry);
		if (live.length === 0) closed.push(order);
		orders.push(...live);
	});
	return {
		orders,
		closed,
		scannedTransactions: recent.length,
		historyTruncated: history.length > recent.length
	};
}

async function inBatches<T>(items: T[], size: number, task: (item: T) => Promise<void>) {
	for (let index = 0; index < items.length; index += size) {
		await Promise.all(items.slice(index, index + size).map(task));
	}
}

/** Broadcast a wallet-signed transaction. Call only from an explicit user action. */
export async function broadcastSignedTransaction(anyAddress: string, signedHex: string): Promise<string> {
	const provider = await chipnetProvider(anyAddress);
	return provider.sendRawTransaction(signedHex, false);
}

export interface TxRecord {
	txid: string;
	kind: string;
	summary: string[];
	at: number;
	status: 'broadcast' | 'confirmed' | 'unknown';
}

export function loadTxHistory(): TxRecord[] {
	try {
		const parsed = JSON.parse(globalThis.localStorage?.getItem(TX_HISTORY_STORAGE_KEY) ?? '[]');
		return Array.isArray(parsed) ? (parsed as TxRecord[]) : [];
	} catch {
		return [];
	}
}

export function saveTxHistory(records: TxRecord[]): void {
	writeStorage(TX_HISTORY_STORAGE_KEY, JSON.stringify(records.slice(0, 50)));
}

/** Confirmation height of a transaction (0/negative = mempool, undefined = unknown). */
export async function transactionHeight(anyAddress: string, txid: string): Promise<number | undefined> {
	const provider = await chipnetProvider(anyAddress);
	try {
		const verbose = await provider.getRawTransaction(txid, true);
		return (verbose.confirmations ?? 0) > 0 ? verbose.confirmations : 0;
	} catch {
		return undefined;
	}
}
