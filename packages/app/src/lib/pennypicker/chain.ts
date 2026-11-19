/**
 * Chain I/O for the PennyPicker exchange (Chipnet and mainnet): market
 * configuration, oracle state, order discovery and broadcasting. The Electrum
 * provider is picked from the address prefix; broadcasting is only ever called
 * from an explicit user action, and refuses mainnet unless MAINNET_WRITES_ENABLED.
 */
import { binToHex, decodeTransaction, hexToBin, secp256k1, sha256, type TransactionCommon } from '@bitauth/libauth';
import { TestNetWatchWallet, WatchWallet } from '@unspent/wallet';
import { decodeOracleCommitment, GP_BCH_USD_ORACLE, oracleContract, parseOracleMessage, type OracleMessage, type OracleState } from './contracts';
import {
	contractAddress,
	describeOrder,
	lockingBytecodeToAddress,
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
import { DEPLOYMENTS, MAINNET_MAX_ORDER_UNITS, MAINNET_WRITES_ENABLED } from './deployment';
import { NETWORKS, networkOfAddress, type NetworkId } from './network';
import { resolveIdentityHead, type IdentityHead } from './identity';

export const ORACLE_CATEGORY_STORAGE_KEY = 'pennypicker:chipnet:oracle-category';
export const ORACLE_OPERATOR_STORAGE_KEY = 'pennypicker:chipnet:oracle-operator-pkh';
export const TX_HISTORY_STORAGE_KEY = 'pennypicker:chipnet:tx-history';

/** Per-network storage key (Chipnet keeps its historical key names). */
export function storageKey(network: NetworkId, chipnetKey: string): string {
	return network === 'chipnet' ? chipnetKey : chipnetKey.replace(NETWORKS.chipnet.storagePrefix, NETWORKS[network].storagePrefix);
}
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

function removeStorage(key: string): void {
	try {
		globalThis.localStorage?.removeItem(key);
	} catch {
		/* storage unavailable */
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
 * Market identity: environment variables first, then the committed public IDs in
 * deployment.ts, then values this browser saved after running a genesis itself.
 */
export function loadMarketConfig(network: NetworkId = 'chipnet'): Partial<MarketConfig> & { source: Record<string, ConfigSource> } {
	const env = import.meta.env ?? {};
	const deployment = DEPLOYMENTS[network];
	// Chipnet keeps the original variable names; mainnet uses VITE_PENNYPICKER_MAINNET_*.
	const envName = (name: string) => (network === 'chipnet' ? `VITE_PENNYPICKER_${name}` : `VITE_PENNYPICKER_MAINNET_${name}`);
	// Precedence: env > committed deployment > this browser. A value saved in the browser only fills a
	// gap (a genesis run here before its IDs were committed); once the deployment names an ID, a stale
	// saved one from an earlier market version is ignored and removed.
	const pick = (name: string, key: string | undefined, fallback: string | undefined, pattern: RegExp) => {
		const fromEnv = String(env[envName(name)] ?? '').trim().toLowerCase();
		if (pattern.test(fromEnv)) return { value: fromEnv, source: 'env' as const };
		const localKey = key ? storageKey(network, key) : undefined;
		const local = localKey ? readStorage(localKey) : '';
		if (fallback && pattern.test(fallback)) {
			if (localKey && local && local !== fallback) removeStorage(localKey);
			return { value: fallback, source: 'default' as const };
		}
		if (pattern.test(local)) return { value: local, source: 'local' as const };
		return { value: undefined, source: 'missing' as const };
	};
	// The mainnet stablecoin is fixed (ParyonUSD): no browser override.
	const pusd = pick('PUSD_CATEGORY', network === 'chipnet' ? PUSD_CATEGORY_STORAGE_KEY : undefined, deployment.pusdCategory, hex32);
	const oracle = pick('ORACLE_CATEGORY', ORACLE_CATEGORY_STORAGE_KEY, deployment.oracleCategory, hex32);
	const operator = pick('ORACLE_OPERATOR_PKH', ORACLE_OPERATOR_STORAGE_KEY, deployment.oracleOperatorPkh, hex20);
	return {
		network,
		...(network === 'mainnet' ? { maxOrderUnits: MAINNET_MAX_ORDER_UNITS } : {}),
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
export async function discoverOracleCategory(operatorPkh: string, network: NetworkId = 'chipnet'): Promise<string | undefined> {
	const address = oracleAddress(operatorPkh, undefined, network);
	const provider = await providerFor(address);
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

export function oracleAddress(operatorPkh: string, oraclePublicKey?: string, network: NetworkId = 'chipnet'): string {
	return contractAddress(oracleContract({ operatorPkh, oraclePublicKey }), true, network);
}

export function marketOracleAddress(market: MarketConfig): string {
	return oracleAddress(market.oracleOperatorPkh, market.oraclePublicKey, market.network ?? 'chipnet');
}

/**
 * Latest signed price message from the General Protocols relay behind oracles.cash.
 * The signature is checked here (and again by the contract when it is used on-chain).
 */
export async function fetchLatestOracleMessage(publicKey: string = GP_BCH_USD_ORACLE.publicKey): Promise<OracleMessage> {
	const url = `${GP_BCH_USD_ORACLE.relay}/api/v1/oracleMessages?publicKey=${publicKey}&count=5`;
	const response = await fetch(url, { cache: 'no-store' });
	if (!response.ok) throw new Error(`oracles.cash relay answered ${response.status}`);
	const body = (await response.json()) as { oracleMessages?: { message: string; signature: string; publicKey: string }[] };
	const candidates = (body.oracleMessages ?? [])
		.filter((entry) => entry.publicKey === publicKey)
		.map((entry) => parseOracleMessage(entry.message, entry.signature))
		.filter((msg) => msg.dataSequence > 0 && msg.price > 0n)
		.filter((msg) => secp256k1.verifySignatureSchnorr(msg.signature, hexToBin(publicKey), sha256.hash(msg.message)))
		.sort((a, b) => b.messageSequence - a.messageSequence);
	const latest = candidates[0];
	if (!latest) throw new Error('No valid signed price message from oracles.cash.');
	return latest;
}

type Provider = Awaited<ReturnType<typeof TestNetWatchWallet.watchOnly>>['provider'];
const providers: Partial<Record<NetworkId, Promise<Provider>>> = {};

/** Network of an address, or an error for anything that is not a Chipnet/mainnet CashAddress. */
export function requireNetwork(address: string): NetworkId {
	const network = networkOfAddress(address);
	if (!network) throw new Error(`Not a BCH Chipnet or mainnet address: ${address.slice(0, 24)}…`);
	return network;
}

/** Shared Electrum provider for the address's network (one connection per network). */
export function providerFor(anyAddress: string): Promise<Provider> {
	const network = requireNetwork(anyAddress);
	const Watch = network === 'mainnet' ? WatchWallet : TestNetWatchWallet;
	providers[network] ??= Watch.watchOnly(anyAddress)
		.then((wallet) => wallet.provider)
		.catch((cause) => {
			// Do not cache a failed connection; the next refresh retries.
			delete providers[network];
			throw cause;
		});
	return providers[network]!;
}

/** @deprecated use providerFor; kept for Chipnet-only scripts. */
export const chipnetProvider = providerFor;

export async function getAddressUtxos(address: string): Promise<ChainUtxo[]> {
	const provider = await providerFor(address);
	return (await provider.getUtxos(address)).map(toChainUtxo);
}

/** Number of transactions Electrum has ever indexed for this address (confirmed + mempool). */
export async function getAddressHistoryCount(address: string): Promise<number> {
	const provider = await providerFor(address);
	return (await provider.getHistory(address)).length;
}

export async function getOracleState(market: MarketConfig): Promise<OracleUtxo | undefined> {
	return findOracleUtxo(await getAddressUtxos(marketOracleAddress(market)), market);
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
	/** Activity fingerprint of the oracle address history this result was built from (see marketActivityFingerprint). */
	fingerprint?: string;
}

/**
 * Discover the market from the oracle address history: every order creation,
 * fill and oracle update spends or recreates the oracle UTXO. Announcements are
 * re-derived into contract addresses (a forged announcement cannot point at a
 * different script), then each address is queried for its live UTXO.
 */
/** Raw transactions never change once known, so discovery downloads each one only once per page load. */
const rawTransactionCache = new Map<string, string>();

/**
 * Cheap, read-only change check for the background poll: one Electrum history request for the market's oracle
 * address. Every order announcement, fill and price update touches that address, so a changed fingerprint means the
 * book needs a full refresh. (Cancels do not touch it; the poll also does a periodic full refresh for those.)
 */
export async function marketActivityFingerprint(market: MarketConfig): Promise<string> {
	const address = marketOracleAddress(market);
	const provider = await providerFor(address);
	return fingerprintOf(await provider.getHistory(address));
}

function fingerprintOf(history: { tx_hash: string; height: number }[]): string {
	return `${history.length}|${history.slice(-12).map((entry) => `${entry.tx_hash}:${entry.height}`).join(',')}`;
}

export async function discoverOrders(market: MarketConfig): Promise<DiscoveryResult> {
	const address = marketOracleAddress(market);
	const provider = await providerFor(address);
	const history = await provider.getHistory(address);
	const recent = history.slice(-DISCOVERY_HISTORY_LIMIT);
	const decodedTxs: { entry: ActivityEvent; tx: TransactionCommon }[] = [];
	await inBatches(recent, 10, async (entry) => {
		const cacheKey = `${market.network ?? "chipnet"}:${entry.tx_hash}`;
		let raw = rawTransactionCache.get(cacheKey);
		if (!raw) {
			raw = await provider.getRawTransaction(entry.tx_hash);
			rawTransactionCache.set(cacheKey, raw);
		}
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
		historyTruncated: history.length > recent.length,
		fingerprint: fingerprintOf(history)
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
	assertBroadcastAllowed(requireNetwork(anyAddress));
	const provider = await providerFor(anyAddress);
	return provider.sendRawTransaction(signedHex, false);
}

/** Safety net behind every UI path: no mainnet broadcast unless the build enables it. */
export function assertBroadcastAllowed(network: NetworkId, writesEnabled = MAINNET_WRITES_ENABLED): void {
	if (network === 'mainnet' && !writesEnabled) {
		throw new Error('Mainnet transactions are switched off in this build. Nothing was broadcast.');
	}
}

export interface TxRecord {
	txid: string;
	kind: string;
	summary: string[];
	at: number;
	status: 'broadcast' | 'confirmed' | 'unknown';
}

export function loadTxHistory(network: NetworkId = 'chipnet'): TxRecord[] {
	try {
		const parsed = JSON.parse(globalThis.localStorage?.getItem(storageKey(network, TX_HISTORY_STORAGE_KEY)) ?? '[]');
		return Array.isArray(parsed) ? (parsed as TxRecord[]) : [];
	} catch {
		return [];
	}
}

export function saveTxHistory(records: TxRecord[], network: NetworkId = 'chipnet'): void {
	writeStorage(storageKey(network, TX_HISTORY_STORAGE_KEY), JSON.stringify(records.slice(0, 50)));
}

/** Confirmation height of a transaction (0/negative = mempool, undefined = unknown). */
export async function transactionHeight(anyAddress: string, txid: string): Promise<number | undefined> {
	const provider = await providerFor(anyAddress);
	try {
		const verbose = await provider.getRawTransaction(txid, true);
		return (verbose.confirmations ?? 0) > 0 ? verbose.confirmations : 0;
	} catch {
		return undefined;
	}
}

/** Resolve a token category's current identity output (BCMR authchain head) on the address's network. */
export async function getIdentityHead(category: string, anyAddress: string): Promise<IdentityHead> {
	const network = requireNetwork(anyAddress);
	const provider = await providerFor(anyAddress);
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
			return (await provider.getHistory(lockingBytecodeToAddress(lockingBytecode, network))).map((entry) => entry.tx_hash);
		},
		async isUnspent(txid, lockingBytecode) {
			const utxos = await provider.getUtxos(lockingBytecodeToAddress(lockingBytecode, network));
			return utxos.some((utxo) => utxo.txid === txid && utxo.vout === 0);
		}
	});
}
