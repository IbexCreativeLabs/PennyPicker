/**
 * WizardConnect (hdwalletv1) connector for PennyPicker: phase 1, "one trading address".
 *
 * WizardConnect pairs a dapp with an HD wallet over an end-to-end encrypted Nostr relay. The wallet shares xpubs;
 * the dapp derives addresses itself and sends sign requests that name the HD path of every input the wallet must
 * sign. PennyPicker's builders are single-address, so this connector uses ONE address of the wallet, receive/0, for
 * everything: funding inputs, change, received tokens and the maker key of orders. Every wallet input PennyPicker
 * creates spends from that address, so every such input is signed with path ["receive", 0]; contract inputs carry
 * their own unlocking bytecode and are not signed by the wallet.
 *
 * This module is loaded on demand (dynamic import) only when the user chooses WizardConnect or has a stored
 * WizardConnect session, so the WalletConnect flow and the main bundle are unaffected.
 *
 * Library: @wizardconnect/core and @wizardconnect/dapp by Whiterun LLC (Riften Labs), LGPL-3.0-or-later,
 * https://gitlab.com/riftenlabs/lib/wizardconnect
 */
import { binToHex, hash160, hexToBin } from '@bitauth/libauth';
import { initiateDappRelay, type DappRelayResult, type PathXpub } from '@wizardconnect/core';
import { DappConnectionManager } from '@wizardconnect/dapp';
import { lockingBytecodeToAddress, p2pkhLockingBytecode, type WcSourceOutput } from '../pennypicker/exchange';
import type { NetworkId } from '../pennypicker/network';

/** The single HD path PennyPicker trades from: BIP44 receive chain, index 0. */
export const TRADING_PATH = { name: 'receive', childIndex: 0, index: 0 } as const;

const sessionKey = (network: NetworkId) => `pennypicker:wizardconnect:${network}`;
const APP_NAME = 'PennyPicker';
const APP_ICON = 'https://pennypicker.pages.dev/pennypicker.svg';

export interface WizardSigner {
	address: string;
	pkh: string;
	walletName: string;
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

/** Derive the trading address from the wallet's receive xpub. */
export function tradingAddress(manager: DappConnectionManager, network: NetworkId) {
	const pubkey = manager.getPubkey(TRADING_PATH.childIndex, BigInt(TRADING_PATH.index));
	if (!pubkey) throw new Error('The wallet did not share a receive path (xpub).');
	const pkh = binToHex(hash160(pubkey));
	return { pkh, address: lockingBytecodeToAddress(p2pkhLockingBytecode(pkh), network, false) };
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
 * Inputs the wallet must sign: exactly those spending the trading address (P2PKH). Exported for tests.
 * Throws if an input spends a different wallet-looking P2PKH script, which this phase cannot sign.
 */
export function inputPathsFor(sourceOutputs: Pick<WcSourceOutput, 'lockingBytecode' | 'unlockingBytecode'>[], tradingPkh: string) {
	const mine = binToHex(p2pkhLockingBytecode(tradingPkh));
	const paths: [number, string, number][] = [];
	sourceOutputs.forEach((so, index) => {
		if (binToHex(so.lockingBytecode) === mine) paths.push([index, TRADING_PATH.name, TRADING_PATH.index]);
	});
	if (paths.length === 0) throw new Error('This transaction has no input from your WizardConnect trading address.');
	return paths;
}

function makeSigner(handle: Handle, network: NetworkId, onEnded?: (reason: string) => void): WizardSigner {
	const { address, pkh } = tradingAddress(handle.manager, network);
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
				inputPaths: inputPathsFor(sourceOutputs, pkh)
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
