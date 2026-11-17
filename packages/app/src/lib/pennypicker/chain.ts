/**
 * Chipnet I/O for the PennyPicker exchange: market configuration, oracle state,
 * order discovery and broadcasting. Reads use the app's Electrum Chipnet
 * provider; broadcasting is only ever called from an explicit user action.
 */
import { binToHex, decodeTransaction, hexToBin, type TransactionCommon } from '@bitauth/libauth';
import { TestNetWatchWallet } from '@unspent/wallet';
import { decodeOracleCommitment, oracleContract, type OracleState } from './contracts';
import {
	contractAddress,
	describeOrder,
	lockingBytecodeToChipnetAddress,
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
import { CHIPNET_DEPLOYMENT } from './deployment';
import { resolveIdentityHead, type IdentityHead } from './identity';

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

export type ConfigSource = 'env' | 'local' | 'default' | 'discovered' | 'missing';

/**
 * Market identity: environment variables (shared deployment) take precedence
 * over values stored locally after this browser ran a genesis, then over the
 * committed public defaults in deployment.ts.
 */
export function loadMarketConfig(): Partial<MarketConfig> & { source: Record<string, ConfigSource> } {
	const env = import.meta.env ?? {};
	const pick = (envKey: string, storageKey: string, fallback: string | undefined, pattern: RegExp) => {
		const fromEnv = String(env[envKey] ?? '').trim().toLowerCase();
		if (pattern.test(fromEnv)) return { value: fromEnv, source: 'env' as const };
		const local = readStorage(storageKey);
		if (pattern.test(local)) return { value: local, source: 'local' as const };
		if (fallback && pattern.test(fallback)) return { value: fallback, source: 'default' as const };
		return { value: undefined, source: 'missing' as const };
	};
	const pusd = pick('VITE_PENNYPICKER_PUSD_CATEGORY', PUSD_CATEGORY_STORAGE_KEY, CHIPNET_DEPLOYMENT.pusdCategory, hex32);
	const oracle = pick('VITE_PENNYPICKER_ORACLE_CATEGORY', ORACLE_CATEGORY_STORAGE_KEY, CHIPNET_DEPLOYMENT.oracleCategory, hex32);
	const operator = pick('VITE_PENNYPICKER_ORACLE_OPERATOR_PKH', ORACLE_OPERATOR_STORAGE_KEY, CHIPNET_DEPLOYMENT.oracleOperatorPkh, hex20);
	return {
		pusdCategory: pusd.value,
		oracleCategory: oracle.value,
		oracleOperatorPkh: operator.value,
		source: { pusdCategory: pusd.source, oracleCategory: oracle.source, oracleOperatorPkh: operator.source }
	};
}

/**
 * Find the oracle category from the operator's oracle contract when it is not
 * configured. Accepts a candidate only if its genesis transaction spent
 * output 0 of a transaction whose output 0 paid the operator's own P2PKH
 * address (i.e. the operator created it). Returns undefined when there is no
 * oracle yet, or when the result is ambiguous.
 */
export async function discoverOracleCategory(operatorPkh: string): Promise<string | undefined> {
	const address = oracleAddress(operatorPkh);
	const provider = await chipnetProvider(address);
	const candidates = (await provider.getUtxos(address))
		.map(toChainUtxo)
		.filter((utxo) => utxo.token?.nft?.capability === 'mutable')
		.filter((utxo) => {
			try {
				decodeOracleCommitment(hexToBin(utxo.token!.nft!.commitment));
				return true;
			} catch {
				return false;
			}
		});
	const operatorLocking = `76a914${operatorPkh}88ac`;
	const verified: string[] = [];
	for (const candidate of candidates) {
		const category = candidate.token!.category;
		try {
			const parent = decodeTransaction(hexToBin(await provider.getRawTransaction(category)));
			if (typeof parent === 'string') continue;
			if (binToHex(parent.outputs[0]?.lockingBytecode ?? new Uint8Array()) === operatorLocking) verified.push(category);
		} catch {
			/* unknown parent: not verifiable */
		}
	}
	const unique = [...new Set(verified)];
	return unique.length === 1 ? unique[0] : undefined;
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
	return (await provider.getUtxos(address)).map(toChainUtxo);
}

/** Number of transactions Electrum has ever indexed for this address (confirmed + mempool). */
export async function getAddressHistoryCount(address: string): Promise<number> {
	const provider = await chipnetProvider(address);
	return (await provider.getHistory(address)).length;
}

export async function getOracleState(market: MarketConfig): Promise<OracleUtxo | undefined> {
	return findOracleUtxo(await getAddressUtxos(oracleAddress(market.oracleOperatorPkh)), market);
}

export interface ActivityEvent {
	txid: string;
	/** > 0 confirmed height; <= 0 mempool. */
	height: number;
}

export interface OracleUpdateEvent extends ActivityEvent {
	state: OracleState;
}

export interface DiscoveryResult {
	orders: OpenOrder[];
	/** Announced orders whose UTXO is gone. Fills always recreate the order, so this means canceled. */
	canceled: AnnouncedOrder[];
	/** Oracle-reading transactions that moved an existing order (fills), newest first. */
	fills: ActivityEvent[];
	/** Oracle states published in scanned history (genesis and updates), newest first. */
	oracleUpdates: OracleUpdateEvent[];
	announcedCount: number;
	scannedTransactions: number;
	historyTruncated: boolean;
}

/**
 * Discover the market from the oracle address history: every order creation,
 * fill and oracle update spends or recreates the oracle UTXO. Announcements are
 * re-derived into contract addresses (a forged announcement cannot point at a
 * different script), then each address is queried for its live UTXO.
 */
export async function discoverOrders(market: MarketConfig): Promise<DiscoveryResult> {
	const address = oracleAddress(market.oracleOperatorPkh);
	const provider = await chipnetProvider(address);
	const history = await provider.getHistory(address);
	const recent = history.slice(-DISCOVERY_HISTORY_LIMIT);
	const decodedTxs: { entry: ActivityEvent; tx: TransactionCommon }[] = [];
	await inBatches(recent, 10, async (entry) => {
		const raw = await provider.getRawTransaction(entry.tx_hash);
		const tx = decodeTransaction(hexToBin(raw));
		if (typeof tx !== 'string') decodedTxs.push({ entry: { txid: entry.tx_hash, height: entry.height }, tx });
	});
	const announced = new Map<string, AnnouncedOrder>();
	const announcingTxids = new Set<string>();
	const oracleUpdates: OracleUpdateEvent[] = [];
	const seenSequences = new Set<number>();
	for (const { entry, tx } of decodedTxs) {
		for (const output of tx.outputs) {
			const parsed = parseAnnouncement(output.lockingBytecode);
			if (parsed) {
				const order = describeOrder(market, parsed);
				const created = tx.outputs.some((candidate) => binToHex(candidate.lockingBytecode) === order.lockingBytecodeHex);
				if (created && !announced.has(order.lockingBytecodeHex)) {
					announced.set(order.lockingBytecodeHex, { ...order, createdTxid: entry.txid });
					announcingTxids.add(entry.txid);
				}
			}
			const token = output.token;
			if (token?.nft?.capability === 'mutable' && binToHex(token.category) === market.oracleCategory) {
				try {
					const state = decodeOracleCommitment(token.nft.commitment);
					if (!seenSequences.has(state.sequence)) {
						seenSequences.add(state.sequence);
						oracleUpdates.push({ ...entry, state });
					}
				} catch {
					/* malformed commitment: ignore */
				}
			}
		}
	}
	const orderScripts = new Set(announced.keys());
	const fills = decodedTxs
		.filter(({ entry, tx }) => !announcingTxids.has(entry.txid) && tx.outputs.some((o) => orderScripts.has(binToHex(o.lockingBytecode))))
		.map(({ entry }) => entry);
	const orders: OpenOrder[] = [];
	const canceled: AnnouncedOrder[] = [];
	await inBatches([...announced.values()], 10, async (order) => {
		const utxos = await provider.getUtxos(order.address);
		const live = utxos
			.map((utxo) => toOpenOrder(order, toChainUtxo(utxo), market))
			.filter((entry): entry is OpenOrder => !!entry);
		if (live.length === 0) canceled.push(order);
		orders.push(...live);
	});
	const newestFirst = (a: ActivityEvent, b: ActivityEvent) => heightKey(b.height) - heightKey(a.height);
	return {
		orders,
		canceled,
		fills: fills.sort(newestFirst),
		oracleUpdates: oracleUpdates.sort((a, b) => b.state.sequence - a.state.sequence),
		announcedCount: announced.size,
		scannedTransactions: recent.length,
		historyTruncated: history.length > recent.length
	};
}

/** Mempool entries (height <= 0) sort as newest. */
function heightKey(height: number): number {
	return height > 0 ? height : Number.MAX_SAFE_INTEGER;
}

function toChainUtxo(utxo: { txid: string; vout: number; satoshis: bigint; height?: number; token?: { category: string; amount: bigint; nft?: { capability: 'none' | 'mutable' | 'minting'; commitment?: string } } }): ChainUtxo {
	return {
		txid: utxo.txid,
		vout: utxo.vout,
		satoshis: utxo.satoshis,
		height: utxo.height,
		...(utxo.token
			? {
					token: {
						category: utxo.token.category,
						amount: utxo.token.amount,
						...(utxo.token.nft ? { nft: { capability: utxo.token.nft.capability, commitment: utxo.token.nft.commitment ?? '' } } : {})
					}
				}
			: {})
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

/** Resolve a token category's current identity output (BCMR authchain head) from Chipnet. */
export async function getIdentityHead(category: string, anyAddress: string): Promise<IdentityHead> {
	const provider = await chipnetProvider(anyAddress);
	const cache = new Map<string, TransactionCommon>();
	return resolveIdentityHead(category, {
		async getTransaction(txid) {
			const hit = cache.get(txid);
			if (hit) return hit;
			const tx = decodeTransaction(hexToBin(await provider.getRawTransaction(txid)));
			if (typeof tx === 'string') throw new Error(`Cannot decode ${txid.slice(0, 12)}…: ${tx}`);
			cache.set(txid, tx);
			return tx;
		},
		async getHistoryTxids(lockingBytecode) {
			return (await provider.getHistory(lockingBytecodeToChipnetAddress(lockingBytecode))).map((entry) => entry.tx_hash);
		},
		async isUnspent(txid, lockingBytecode) {
			const utxos = await provider.getUtxos(lockingBytecodeToChipnetAddress(lockingBytecode));
			return utxos.some((utxo) => utxo.txid === txid && utxo.vout === 0);
		}
	});
}
