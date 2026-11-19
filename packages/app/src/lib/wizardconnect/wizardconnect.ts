/**
 * WizardConnect (hdwalletv1) connector for PennyPicker: the whole HD wallet.
 *
 * WizardConnect pairs a dapp with an HD wallet over an end-to-end encrypted Nostr relay. The wallet shares one xpub
 * per path (receive, change, …); the dapp derives addresses itself and sends sign requests that name the HD path of
 * every input the wallet must sign.
 *
 * Like other WizardConnect dapps, PennyPicker scans every shared path for used addresses (BIP44 gap limit), shows
 * the balance of all of them and funds transactions from any of them; each wallet input is signed with its own path.
 * Change, proceeds and the maker key of new orders use the wallet's first receive address (receive/0), so orders
 * made over WizardConnect are found again on every device. Contract inputs carry their own unlocking bytecode and
 * are not signed by the wallet.
 *
 * This module is loaded on demand (dynamic import) only when the user chooses WizardConnect or has a stored
 * WizardConnect session, so the WalletConnect flow and the main bundle are unaffected.
 *
 * Library: @wizardconnect/core and @wizardconnect/dapp by Whiterun LLC (Riften Labs), LGPL-3.0-or-later,
 * https://gitlab.com/riftenlabs/lib/wizardconnect
 */
import { binToHex, hash160, hexToBin } from '@bitauth/libauth';
import { childIndexOfPathName, initiateDappRelay, type DappRelayResult, type PathXpub } from '@wizardconnect/core';
import { DappConnectionManager } from '@wizardconnect/dapp';
import { lockingBytecodeToAddress, p2pkhLockingBytecode, type WcSourceOutput } from '../pennypicker/exchange';
import type { NetworkId } from '../pennypicker/network';

/** Home address: BIP44 receive chain, index 0. Change, proceeds and the maker key of new orders go here. */
export const HOME_PATH = { name: 'receive', childIndex: 0, index: 0 } as const;
/** Consecutive unused addresses that end a path scan (BIP44 default). */
export const GAP_LIMIT = 20;

/** One derived wallet address and the HD path that signs for it. */
export interface HdAddress {
	path: [name: string, index: number];
	address: string;
	pkh: string;
	/** P2PKH locking bytecode (hex). */
	lockingHex: string;
}

const sessionKey = (network: NetworkId) => `pennypicker:wizardconnect:${network}`;
const APP_NAME = 'PennyPicker';
const APP_ICON = 'https://pennypicker.pages.dev/pennypicker-192.png';

export interface WizardSigner {
	/** Home address (receive/0). */
	address: string;
	pkh: string;
	walletName: string;
	/** Path names the wallet shared that map to a BIP44 chain (receive, change, defi). */
	pathNames: () => string[];
	/** Derive the address at a path and index. */
	addressAt: (name: string, index: number) => HdAddress;
	/** Addresses the signer may sign for (set after each scan; the home address is always included). */
	setKnown: (addresses: HdAddress[]) => void;
	/** Sign (never broadcast) an unsigned transaction; resolves with the signed hex. */
	sign: (unsignedHex: string, sourceOutputs: WcSourceOutput[], userPrompt: string) => Promise<string>;
	disconnect: () => Promise<void>;
	/** True while the relay is connected to the wallet (signing works only then). */
	isLive: () => boolean;
	/** Close the relay but keep the stored session (e.g. when switching to the other network). */
	suspend: () => void;
}

interface Handle {
	manager: DappConnectionManager;
	relay: DappRelayResult;
	connected: boolean;
	/** Set when the wallet ended the session or stopped answering; signing then fails fast. */
	ended?: string;
}

/** A sign request the wallet never answers is cancelled after this long. */
const SIGN_TIMEOUT_MS = 180_000;

/** Derive the address at `name`/`index` from the xpubs the wallet shared. */
export function deriveAddress(manager: DappConnectionManager, network: NetworkId, name: string, index: number): HdAddress {
	const childIndex = childIndexOfPathName(name);
	const pubkey = childIndex === undefined ? undefined : manager.getPubkey(childIndex, BigInt(index));
	if (!pubkey) throw new Error(`The wallet did not share the "${name}" path (xpub).`);
	const pkh = binToHex(hash160(pubkey));
	const locking = p2pkhLockingBytecode(pkh);
	return { path: [name, index], pkh, lockingHex: binToHex(locking), address: lockingBytecodeToAddress(locking, network, false) };
}

/** Home address (receive/0) derived from the wallet's receive xpub. */
export function tradingAddress(manager: DappConnectionManager, network: NetworkId) {
	return deriveAddress(manager, network, HOME_PATH.name, HOME_PATH.index);
}

/** Shared path names that map to a BIP44 chain, in a stable order (receive first). */
export function scanPathNames(paths: PathXpub[]): string[] {
	const names = paths.map((p) => p.name).filter((name) => childIndexOfPathName(name) !== undefined);
	return [...new Set(names)].sort((a, b) => childIndexOfPathName(a)! - childIndexOfPathName(b)!);
}

/**
 * Find the wallet's used addresses: walk each path until `gap` consecutive addresses have no history (checked
 * `gap` at a time, in parallel). The home address is always returned first, used or not.
 */
export async function discoverAddresses(
	derive: (name: string, index: number) => HdAddress,
	pathNames: string[],
	hasHistory: (address: string) => Promise<boolean>,
	gap = GAP_LIMIT
): Promise<HdAddress[]> {
	const found: HdAddress[] = [derive(HOME_PATH.name, HOME_PATH.index)];
	for (const name of pathNames) {
		let lastUsed = -1;
		for (let start = 0; start <= lastUsed + gap; start += gap) {
			const batch = Array.from({ length: gap }, (_, i) => derive(name, start + i));
			const used = await Promise.all(batch.map((entry) => hasHistory(entry.address)));
			batch.forEach((entry, i) => {
				if (!used[i]) return;
				lastUsed = Math.max(lastUsed, start + i);
				if (entry.lockingHex !== found[0]!.lockingHex) found.push(entry);
			});
		}
	}
	return found;
}

/** Same relay-safe JSON as @wizardconnect/core's sourceOutputToRelay: hex strings and `<bigint: Xn>`. */
export function sourceOutputToRelay(so: WcSourceOutput) {
	const relay: Record<string, unknown> = {
		outpointTransactionHash: binToHex(so.outpointTransactionHash),
		outpointIndex: so.outpointIndex,
		unlockingBytecode: binToHex(so.unlockingBytecode),
		sequenceNumber: so.sequenceNumber,
		valueSatoshis: `<bigint: ${so.valueSatoshis}n>`,
		lockingBytecode: binToHex(so.lockingBytecode)
	};
	if (so.token) {
		relay.token = {
			category: binToHex(so.token.category),
			amount: `<bigint: ${so.token.amount}n>`,
			...(so.token.nft && {
				nft: {
					capability: so.token.nft.capability,
					commitment: binToHex(so.token.nft.commitment)
				}
			})
		};
	}
	return relay;
}

/**
 * Inputs the wallet must sign: every input spending one of the wallet's known addresses, with that address's path.
 * Contract inputs (non-empty unlocking bytecode) are skipped; any other unknown input is refused. Exported for tests.
 */
export function inputPathsFor(
	sourceOutputs: Pick<WcSourceOutput, 'lockingBytecode' | 'unlockingBytecode'>[],
	known: ReadonlyMap<string, [string, number]>
) {
	const paths: [number, string, number][] = [];
	sourceOutputs.forEach((so, index) => {
		const path = known.get(binToHex(so.lockingBytecode));
		if (path) paths.push([index, path[0], path[1]]);
		else if (so.unlockingBytecode.length === 0) throw new Error(`Input ${index} spends an address this WizardConnect session does not know.`);
	});
	if (paths.length === 0) throw new Error('This transaction has no input from your WizardConnect wallet.');
	return paths;
}

function makeSigner(handle: Handle, network: NetworkId, onEnded?: (reason: string) => void): WizardSigner {
	const { address, pkh } = tradingAddress(handle.manager, network);
	const derive = (name: string, index: number) => deriveAddress(handle.manager, network, name, index);
	const known = new Map<string, [string, number]>([[binToHex(p2pkhLockingBytecode(pkh)), [HOME_PATH.name, HOME_PATH.index]]]);
	const end = (reason: string) => {
		if (handle.ended) return;
		handle.ended = reason;
		onEnded?.(reason);
	};
	handle.manager.on('disconnect', () => end('The wallet ended the WizardConnect session. Reconnect on the Wallet page.'));
	// 'reconnecting' (no pong for ~75 s) is NOT treated as the end: a phone wallet goes quiet when the screen locks and
	// resumes with wallet_ready. A request it never answers times out instead (SIGN_TIMEOUT_MS).
	return {
		address,
		pkh,
		walletName: handle.manager.walletName ?? 'WizardConnect wallet',
		pathNames: () => scanPathNames(handle.manager.getSessionPaths()),
		addressAt: derive,
		setKnown(addresses) {
			for (const entry of addresses) known.set(entry.lockingHex, entry.path);
		},
		isLive: () => handle.connected,
		async sign(unsignedHex, sourceOutputs, userPrompt) {
			if (handle.ended) throw new Error(handle.ended);
			await waitFor(() => handle.connected, 60_000, 'The wallet is not reachable over WizardConnect. Open your wallet app and try again.');
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort('timeout'), SIGN_TIMEOUT_MS);
			const response = await handle.manager.signTransaction({
				transaction: {
					transaction: unsignedHex,
					// Relay JSON; the library sends it with JSON.stringify and the wallet parses the extended format.
					sourceOutputs: sourceOutputs.map(sourceOutputToRelay) as never,
					broadcast: false,
					userPrompt
				},
				inputPaths: inputPathsFor(sourceOutputs, known)
			}, { signal: controller.signal }).catch((cause: unknown) => {
				if (controller.signal.aborted) throw new Error('The wallet did not answer the signing request. Open your wallet, or reconnect on the Wallet page.');
				throw cause;
			}).finally(() => clearTimeout(timer));
			if (response.error) throw new Error(response.error);
			if (!response.signedTransaction) throw new Error('The wallet returned no signed transaction.');
			hexToBin(response.signedTransaction); // throws on malformed hex
			return response.signedTransaction;
		},
		suspend() {
			void handle.manager.destroy().finally(() => handle.relay.cleanup());
		},
		async disconnect() {
			try {
				handle.manager.clearStoredSession();
				await handle.manager.sendDisconnect('Disconnected from PennyPicker');
			} finally {
				await handle.manager.destroy().catch(() => undefined);
				handle.relay.cleanup();
			}
		}
	};
}

function waitFor(check: () => boolean, ms: number, message: string) {
	if (check()) return Promise.resolve();
	return new Promise<void>((resolve, reject) => {
		const started = Date.now();
		const timer = setInterval(() => {
			if (check()) {
				clearInterval(timer);
				resolve();
			} else if (Date.now() - started > ms) {
				clearInterval(timer);
				reject(new Error(message));
			}
		}, 250);
	});
}

function startRelay(manager: DappConnectionManager, existing?: { privateKey: string; secret: string; walletPublicKey: string }): Handle {
	const handle = { manager, connected: false } as Handle;
	handle.relay = initiateDappRelay(
		(payload) => {
			handle.connected = payload.status.status === 'connected';
			manager.updateConnection(payload.client, payload.status);
		},
		existing ? { existingCredentials: existing } : undefined
	);
	manager.attachRelay(handle.relay);
	return handle;
}

/**
 * Start a new pairing. Returns the `wiz://` URI to show as a QR code (or open in the wallet), and a promise that
 * resolves once the wallet has connected and shared its xpubs.
 */
export function pairWizardConnect(network: NetworkId, onEnded?: (reason: string) => void): { uri: string; ready: Promise<WizardSigner>; cancel: () => void } {
	const manager = new DappConnectionManager(APP_NAME, APP_ICON, { session: { key: sessionKey(network) } });
	const handle = startRelay(manager);
	let cancelled = false;
	const ready = new Promise<WizardSigner>((resolve, reject) => {
		manager.once('walletready', () => {
			if (cancelled) return;
			try {
				resolve(makeSigner(handle, network, onEnded));
			} catch (cause) {
				reject(cause);
			}
		});
		manager.once('disconnect', (reason) => reject(new Error(`The wallet ended the pairing (${reason}).`)));
	});
	return {
		uri: handle.relay.uri,
		ready,
		cancel: () => {
			cancelled = true;
			manager.clearStoredSession();
			void manager.destroy().finally(() => handle.relay.cleanup());
		}
	};
}

/** Whether a WizardConnect session for this network is stored in this browser. */
export function hasStoredWizardSession(network: NetworkId): boolean {
	try {
		const raw = localStorage.getItem(sessionKey(network));
		if (!raw) return false;
		const stored = JSON.parse(raw) as { walletPublicKey?: string; paths?: PathXpub[] };
		return !!stored.walletPublicKey && !!stored.paths?.length;
	} catch {
		return false;
	}
}

/**
 * Restore a stored session: the trading address is derived from the stored xpubs at once (no wallet round trip),
 * and the relay reconnects in the background for signing.
 */
export function restoreWizardConnect(network: NetworkId, onEnded?: (reason: string) => void): WizardSigner | undefined {
	const manager = new DappConnectionManager(APP_NAME, APP_ICON, { session: { key: sessionKey(network) } });
	const stored = manager.loadStoredSession();
	if (!stored?.walletPublicKey || !stored.paths?.length) return undefined;
	manager.restoreSessionPaths(stored.paths);
	try {
		const handle = startRelay(manager, { privateKey: stored.privateKey, secret: stored.secret, walletPublicKey: stored.walletPublicKey });
		if (stored.walletName) manager.walletName = stored.walletName;
		return makeSigner(handle, network, onEnded);
	} catch {
		manager.clearStoredSession();
		return undefined;
	}
}
