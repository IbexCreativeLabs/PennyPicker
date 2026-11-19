/**
 * Shared PennyPicker app state: Cashonize session, market identity, oracle,
 * balances and the discovered orderbook. Every status shown in the UI is
 * derived from this data (Electrum reads), never from button clicks.
 */
import {
	createCashonizeClient,
	describeWalletConnectError,
	disconnectCashonizeSession,
	getApprovedSession,
	requestAddresses,
	requestCashonizeSession
} from '$lib/cashonize/walletconnect';
import {
	discoverOracleCategory,
	discoverOrders,
	marketActivityFingerprint,
	getAddressHistoryCount,
	getAddressUtxos,
	getIdentityHead,
	getOracleState,
	isCompleteMarket,
	loadMarketConfig,
	loadTxHistory,
	saveTxHistory,
	transactionHeight,
	type DiscoveryResult,
	type TxRecord,
	fetchLatestOracleMessage,
	marketOracleAddress
} from '$lib/pennypicker/chain';
import { oracleStateFromMessage, type OracleMessage } from '$lib/pennypicker/contracts';
import { MARKETS, type MarketId } from '$lib/pennypicker/deployment';
import { makerPkhFromAddress, type ChainUtxo, type MarketConfig, type OracleUtxo, type UnsignedExchangeTransaction } from '$lib/pennypicker/exchange';
import { NETWORKS, type NetworkId } from '$lib/pennypicker/network';
import { markIdentityOutputs, type IdentityHead } from '$lib/pennypicker/identity';
import { balancesOf, errorText, type ConnectedWallet, type WalletConnectWallet, type WizardConnectWallet } from './wallet';
import type { WizardSigner } from '$lib/wizardconnect/wizardconnect';

export const STALE_AFTER_SECONDS = 15 * 60;

/** Background poll cadence: a one-request change check (see poll()). */
const POLL_INTERVAL_MS = 5_000;
/** Full book reload even without activity, to pick up cancels (which do not touch the oracle address). */
const FULL_REFRESH_MS = 60_000;
const WALLET_REFRESH_MS = 30_000;
/** oracles.cash price feed refresh while a PennyPicker tab is visible (the header shows the price on every page). */
const FEED_REFRESH_MS = 20_000;
/** HD wallets (WizardConnect): look for newly used addresses this often while a page that shows balances is open. */
const HD_RESCAN_MS = 120_000;
/** How long a WalletConnect session restore may wait for Cashonize before the connect buttons are re-enabled. */
const RESTORE_TIMEOUT_MS = 20_000;

class PennyPickerSession {
	wallet = $state<ConnectedWallet | undefined>();
	walletStatus = $state<'checking' | 'disconnected' | 'connecting' | 'connected'>('checking');
	pairingUri = $state('');
	walletError = $state('');

	/** Stablecoin selected in the header menu. Only 'live' markets can trade. */
	selectedMarketId = $state<MarketId>('pennypickerusd');
	selectedMarket = $derived(MARKETS.find((m) => m.id === this.selectedMarketId) ?? MARKETS[0]!);
	/** Network of the selected market: drives Electrum, addresses, WalletConnect chain and explorers. */
	network = $derived<NetworkId>(this.selectedMarket.network);
	networkInfo = $derived(NETWORKS[this.network]);
	config = $state(loadMarketConfig('chipnet'));

	selectMarket(id: MarketId) {
		if (!MARKETS.some((m) => m.id === id)) return;
		const before = this.network;
		this.selectedMarketId = id;
		try {
			localStorage.setItem('pennypicker:selected-market', id);
		} catch {
			/* storage unavailable */
		}
		if (this.network !== before) void this.switchNetwork();
	}

	/** Drop everything tied to the previous network, then reload for the new one. */
	private async switchNetwork() {
		this.oracle = undefined;
		this.oracleLoaded = false;
		this.discovery = undefined;
		this.pusdIdentity = undefined;
		this.marketError = '';
		this.walletError = '';
		this.history = loadTxHistory(this.network);
		this.reloadConfig();
		if (this.wallet && this.wallet.network !== this.network) this.forgetWallet();
		this.walletStatus = 'checking';
		await Promise.all([
			this.refreshMarket().then(() => this.refreshHistory()),
			this.restoreSession().then(() => this.refreshWallet()),
			this.refreshFeed()
		]);
	}
	utxos = $state<ChainUtxo[]>([]);
	utxosLoaded = $state(false);
	oracle = $state<OracleUtxo | undefined>();
	oracleLoaded = $state(false);
	discovery = $state<DiscoveryResult | undefined>();
	loadingWallet = $state(false);
	/** Current PUSD identity output (BCMR authchain head), resolved from Chipnet. */
	pusdIdentity = $state<IdentityHead | undefined>();
	loadingMarket = $state(false);
	marketError = $state('');
	history = $state<TxRecord[]>([]);
	nowSec = $state(Math.floor(Date.now() / 1000));
	/** Number of open transaction dialogs; background refreshes pause while any is open. */
	txOpen = $state(0);

	market = $derived<MarketConfig | undefined>(isCompleteMarket(this.config) ? this.config : undefined);
	balances = $derived(balancesOf(this.utxos, this.config.pusdCategory));
	/** Latest signed BCH/USD message from oracles.cash (refreshed every FEED_REFRESH_MS while the tab is visible). */
	feed = $state<OracleMessage | undefined>();
	feedError = $state('');
	/** Price of the oracle message before the current one, to show the direction of the last move. */
	previousFeedPrice = $state<bigint | undefined>();
	/** The feed's message when it is newer than the on-chain state: new orders and fills carry it. */
	refreshMessage = $derived(this.feed && this.oracle && this.feed.messageSequence > this.oracle.state.sequence ? this.feed : undefined);
	/** The price the next order or fill settles at (the bundled feed price, else the on-chain state). */
	effectiveState = $derived(this.refreshMessage ? oracleStateFromMessage(this.refreshMessage) : this.oracle?.state);
	price = $derived(this.effectiveState?.price);
	/** Price to display: the market's settlement price, else the live oracles.cash feed (markets without an on-chain record). */
	displayPrice = $derived(this.price ?? (this.feed ? oracleStateFromMessage(this.feed).price : undefined));
	oracleAge = $derived(this.effectiveState ? Math.max(0, this.nowSec - this.effectiveState.timestamp) : undefined);
	oracleStale = $derived(this.oracleAge !== undefined && this.oracleAge > STALE_AFTER_SECONDS);
	isOperator = $derived(!!this.wallet && !!this.config.oracleOperatorPkh && this.wallet.pkh === this.config.oracleOperatorPkh);

	/** A confirmed BCH-only output at index 0 (needed for a CashToken genesis). */
	genesisReadyUtxo = $derived(
		this.utxos.find((u) => u.vout === 0 && !u.token && !u.identityOf && (u.height ?? 0) > 0) ??
			this.utxos.find((u) => u.vout === 0 && !u.token && !u.identityOf)
	);
	/** The PUSD identity output, when the connected wallet holds it. */
	ownIdentityUtxo = $derived(this.pusdIdentity ? this.utxos.find((u) => u.txid === this.pusdIdentity!.txid && u.vout === 0) : undefined);

	private started = false;

	/** Called once by the PennyPicker layout. */
	start() {
		if (this.started) return;
		this.started = true;
		try {
			const saved = localStorage.getItem('pennypicker:selected-market');
			if (MARKETS.some((m) => m.id === saved)) this.selectedMarketId = saved as MarketId;
		} catch {
			/* storage unavailable */
		}
		this.history = loadTxHistory(this.network);
		this.reloadConfig();
		setInterval(() => (this.nowSec = Math.floor(Date.now() / 1000)), 5_000);
		void this.refreshFeed();
		setInterval(() => {
			if (document.visibilityState === 'visible') void this.refreshFeed();
		}, FEED_REFRESH_MS);
		// Market data must not wait for the wallet: restoring a session asks Cashonize for its address, which can take a
		// long time when the wallet app is asleep. Load the book and price straight away, and the wallet in parallel.
		void this.refreshMarket().then(() => this.refreshHistory());
		void this.restoreSession().then(() => this.refreshWallet());
		setInterval(() => void this.poll(), POLL_INTERVAL_MS);
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState !== 'visible') return;
			this.nowSec = Math.floor(Date.now() / 1000);
			void this.refreshFeed();
			void this.poll();
		});
	}

	/** Pages that show the book (Exchange) or balances (Exchange, Wallet) register while open; polling serves only them. */
	private marketWatchers = 0;
	private walletWatchers = 0;

	/** Keep the order book live while the calling page is open. Returns the unsubscribe function. */
	watchMarket(): () => void {
		this.marketWatchers++;
		this.walletWatchers++;
		void this.poll();
		return () => {
			this.marketWatchers--;
			this.walletWatchers--;
		};
	}

	/** Keep wallet balances live while the calling page is open. Returns the unsubscribe function. */
	watchWallet(): () => void {
		this.walletWatchers++;
		void this.poll();
		return () => this.walletWatchers--;
	}

	private polling = false;
	private lastFullMarketRefresh = 0;
	private lastWalletRefresh = 0;

	/**
	 * Read-only background refresh, only while the tab is visible and a page that shows the data is open. Every few
	 * seconds it makes one cheap Electrum request (the oracle address history); the book is reloaded only when that
	 * changed, or once a minute to catch cancels. It never overlaps itself, and pauses while a transaction dialog is
	 * open. It only reads chain data: it builds, signs and broadcasts nothing, and it does not touch form input.
	 */
	private async poll() {
		if (this.polling || this.loadingMarket || this.txOpen > 0 || document.visibilityState !== 'visible') return;
		if (this.marketWatchers === 0 && this.walletWatchers === 0) return;
		this.polling = true;
		const network = this.network;
		try {
			const now = Date.now();
			const market = this.market;
			let walletDone = false;
			if (this.marketWatchers > 0 && market && this.oracleLoaded) {
				const fingerprint = await marketActivityFingerprint(market);
				if (network !== this.network || this.txOpen > 0) return;
				const changed = fingerprint !== this.discovery?.fingerprint;
				if (changed || now - this.lastFullMarketRefresh > FULL_REFRESH_MS) {
					await this.refreshMarket();
					if (changed) {
						await this.refreshWallet();
						walletDone = true;
					}
				}
			}
			if (!walletDone && this.wallet && now - this.lastWalletRefresh > WALLET_REFRESH_MS) {
				await this.refreshWallet({ rescan: now - this.lastHdScan > HD_RESCAN_MS });
			}
		} catch {
			/* transient network error: the next tick retries */
		} finally {
			this.polling = false;
		}
	}

	reloadConfig() {
		this.config = loadMarketConfig(this.network);
	}

	/** Reuse an existing approved Cashonize session without prompting. */
	async restoreSession() {
		try {
			// A stored WizardConnect session is the newer choice (connecting with WalletConnect removes it), and
			// restoring it needs no wallet round trip: try it first.
			if (await this.restoreWizard()) return;
			if (!import.meta.env.VITE_WALLETCONNECT_PROJECT_ID) {
				this.walletStatus = 'disconnected';
				return;
			}
			const client = await createCashonizeClient();
			const session = getApprovedSession(client, this.networkInfo.walletConnectChain);
			if (!session) {
				this.walletStatus = 'disconnected';
				return;
			}
			// Restoring asks Cashonize for its address. If the wallet does not answer (app asleep, tab closed), do not
			// leave the page stuck on "checking": re-enable the connect buttons after a while. A late answer still connects.
			const adopted = this.adopt(client, session).then(() => 'ok' as const);
			const outcome = await Promise.race([adopted, new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), RESTORE_TIMEOUT_MS))]);
			if (outcome === 'timeout' && this.walletStatus === 'checking') {
				this.walletStatus = 'disconnected';
				this.walletError = 'Cashonize did not answer. Open Cashonize (on the same network) and it will reconnect, or connect again.';
				// A late answer still connects: clear the message and load the balances then.
				adopted
					.then(() => {
						this.walletError = '';
						return this.refreshWallet();
					})
					.catch(() => undefined);
			}
		} catch (cause) {
			this.walletStatus = 'disconnected';
			this.walletError = describeWalletConnectError(cause);
		}
	}

	private async adopt(client: WalletConnectWallet['client'], session: WalletConnectWallet['session']) {
		const network = this.network;
		const [address] = await requestAddresses(client, session, NETWORKS[network].walletConnectChain);
		if (!address) throw new Error(`Cashonize returned no ${NETWORKS[network].label} address.`);
		// The user may have switched markets while Cashonize was answering.
		if (network !== this.network) return;
		if (this.wallet?.kind === 'wizardconnect') this.wallet.signer.suspend();
		this.wallet = { kind: 'walletconnect', client, session, address, pkh: makerPkhFromAddress(address, network), network };
		this.walletStatus = 'connected';
		const clear = ({ topic }: { topic: string }) => {
			if (this.wallet?.kind !== 'wizardconnect' && this.wallet?.session.topic === topic) this.forgetWallet();
		};
		client.on('session_delete', clear);
		client.on('session_expire', clear);
	}

	private forgetWallet() {
		if (this.wallet?.kind === 'wizardconnect') this.wallet.signer.suspend();
		this.wallet = undefined;
		this.walletStatus = 'disconnected';
		this.utxos = [];
		this.utxosLoaded = false;
	}

	/** Pair a new Cashonize session (same WalletConnect flow as /cashonize). */
	async connect() {
		if (this.walletStatus === 'connecting') return;
		this.walletStatus = 'connecting';
		this.walletError = '';
		try {
			const client = await createCashonizeClient();
			const chain = this.networkInfo.walletConnectChain;
			const existing = getApprovedSession(client, chain);
			if (existing) {
				await this.adopt(client, existing);
			} else {
				const { uri, approval } = await requestCashonizeSession(client, chain);
				this.pairingUri = uri ?? '';
				const session = await approval();
				this.pairingUri = '';
				await this.adopt(client, session);
			}
			await this.forgetStoredWizard();
			await this.refreshWallet();
		} catch (cause) {
			this.pairingUri = '';
			this.walletStatus = this.wallet ? 'connected' : 'disconnected';
			this.walletError = describeWalletConnectError(cause);
		}
	}

	/** WizardConnect pairing URI (wiz://…) while a pairing is in progress. */
	wizardUri = $state('');
	private wizardCancel: (() => void) | undefined;

	/** The user chose WalletConnect: end any stored WizardConnect session for this network so it is not restored later. */
	private async forgetStoredWizard() {
		const wizard = await import('$lib/wizardconnect/wizardconnect');
		if (!wizard.hasStoredWizardSession(this.network)) return;
		const stale = wizard.restoreWizardConnect(this.network);
		await stale?.disconnect().catch(() => undefined);
	}

	/** Restore a stored WizardConnect session for this network. Returns true if one was adopted. */
	private async restoreWizard(): Promise<boolean> {
		const network = this.network;
		const wizard = await import('$lib/wizardconnect/wizardconnect');
		if (!wizard.hasStoredWizardSession(network)) return false;
		const signer = wizard.restoreWizardConnect(network, (reason) => this.wizardEnded(reason));
		if (!signer || network !== this.network) return false;
		this.wallet = this.wizardWallet(signer, network);
		this.walletStatus = 'connected';
		this.lastHdScan = 0;
		return true;
	}

	private wizardWallet(signer: WizardSigner, network: NetworkId): WizardConnectWallet {
		return { kind: 'wizardconnect', signer, address: signer.address, pkh: signer.pkh, network, addresses: [signer.addressAt('receive', 0)] };
	}

	/** Time of the last HD address scan (WizardConnect). */
	private lastHdScan = 0;
	/** True while an HD wallet's addresses are being scanned. */
	scanningAddresses = $state(false);

	private scan: Promise<void> | undefined;

	/** Find every used address of the connected HD wallet (gap-limit scan of each shared path). Overlapping calls share one scan. */
	private scanHdAddresses(wallet: WizardConnectWallet): Promise<void> {
		this.scan ??= this.runHdScan(wallet).finally(() => (this.scan = undefined));
		return this.scan;
	}

	private async runHdScan(wallet: WizardConnectWallet) {
		const wizard = await import('$lib/wizardconnect/wizardconnect');
		this.scanningAddresses = true;
		try {
			const found = await wizard.discoverAddresses(
				wallet.signer.addressAt,
				wallet.signer.pathNames(),
				async (address) => (await getAddressHistoryCount(address)) > 0
			);
			wallet.signer.setKnown(found);
			if (this.wallet === wallet) this.wallet = { ...wallet, addresses: found };
			this.lastHdScan = Date.now();
		} finally {
			this.scanningAddresses = false;
		}
	}

	/** Pair an HD wallet over WizardConnect (the wallet scans the wiz:// QR code). */
	async connectWizard() {
		if (this.walletStatus === 'connecting') return;
		this.walletStatus = 'connecting';
		this.walletError = '';
		const network = this.network;
		try {
			const wizard = await import('$lib/wizardconnect/wizardconnect');
			const pairing = wizard.pairWizardConnect(network, (reason) => this.wizardEnded(reason));
			this.wizardCancel = pairing.cancel;
			this.wizardUri = pairing.uri;
			const signer = await pairing.ready;
			this.wizardUri = '';
			this.wizardCancel = undefined;
			if (network !== this.network) {
				signer.suspend();
				throw new Error('The market changed while pairing; pair again on this network.');
			}
			this.wallet = this.wizardWallet(signer, network);
			this.walletStatus = 'connected';
			this.lastHdScan = 0;
			await this.refreshWallet({ rescan: true });
		} catch (cause) {
			this.wizardUri = '';
			this.walletStatus = this.wallet ? 'connected' : 'disconnected';
			this.walletError = errorText(cause);
		}
	}

	/** The wallet ended or abandoned the WizardConnect session: drop it (the stored session is cleared too). */
	private wizardEnded(reason: string) {
		if (this.wallet?.kind !== 'wizardconnect') return;
		const signer = this.wallet.signer;
		this.wallet = undefined;
		this.walletStatus = 'disconnected';
		this.utxos = [];
		this.utxosLoaded = false;
		this.walletError = reason;
		void signer.disconnect().catch(() => undefined);
	}

	cancelWizardPairing() {
		this.wizardCancel?.();
		this.wizardCancel = undefined;
		this.wizardUri = '';
		if (this.walletStatus === 'connecting') this.walletStatus = this.wallet ? 'connected' : 'disconnected';
	}

	async disconnect() {
		if (!this.wallet) return;
		try {
			if (this.wallet.kind === 'wizardconnect') {
				const signer = this.wallet.signer;
				this.wallet = undefined;
				await signer.disconnect();
			} else {
				await disconnectCashonizeSession(this.wallet.client, this.wallet.session);
			}
		} catch (cause) {
			this.walletError = describeWalletConnectError(cause);
		}
		this.forgetWallet();
	}

	/**
	 * Reload the wallet's coins. An HD wallet (WizardConnect) is read across all its used addresses, each coin tagged
	 * with the address that holds it; `rescan` (or a first load) looks for newly used addresses first.
	 */
	async refreshWallet(options: { rescan?: boolean } = {}) {
		if (!this.wallet) return;
		this.loadingWallet = true;
		try {
			let wallet = this.wallet;
			let raw: ChainUtxo[];
			if (wallet.kind === 'wizardconnect') {
				if (options.rescan || this.lastHdScan === 0) {
					await this.scanHdAddresses(wallet);
					if (!this.wallet || this.wallet.kind !== 'wizardconnect') return;
					wallet = this.wallet;
				}
				const lists = await Promise.all(
					(wallet as WizardConnectWallet).addresses.map(async (entry) =>
						(await getAddressUtxos(entry.address)).map((utxo) => ({ ...utxo, ownerLocking: entry.lockingHex }))
					)
				);
				raw = lists.flat();
			} else {
				raw = await getAddressUtxos(wallet.address);
			}
			if (this.wallet !== wallet && this.wallet?.address !== wallet.address) return;
			const category = this.config.pusdCategory;
			let head: IdentityHead | undefined;
			// Identity outputs only matter where this app mints or manages the token (Chipnet PUSD).
			const tracksIdentity = this.network === 'chipnet';
			if (category && tracksIdentity) {
				try {
					head = await getIdentityHead(category, wallet.address);
				} catch {
					// Unresolved: every output-0 coin is held back below until the identity output can be found.
				}
			}
			this.pusdIdentity = head;
			this.utxos = markIdentityOutputs(raw, head ? [head] : [], tracksIdentity && category && !head ? [category] : []);
			this.utxosLoaded = true;
			this.lastWalletRefresh = Date.now();
		} catch (cause) {
			this.walletError = `Balance query failed: ${errorText(cause)}`;
		} finally {
			this.loadingWallet = false;
		}
	}

	async refreshMarket() {
		this.reloadConfig();
		// The user can switch markets while this runs: results for another network are dropped.
		const network = this.network;
		if (!this.config.oracleCategory && this.config.oracleOperatorPkh) {
			try {
				const found = await discoverOracleCategory(this.config.oracleOperatorPkh, network);
				if (network !== this.network) return;
				if (found) {
					this.config = { ...this.config, oracleCategory: found, source: { ...this.config.source, oracleCategory: 'discovered' } };
				}
				this.marketError = '';
			} catch (cause) {
				this.marketError = `${this.networkInfo.label} Electrum server unreachable: ${errorText(cause)}`;
				this.oracleLoaded = true;
				return;
			}
		}
		const market = this.market;
		if (!market) {
			this.oracleLoaded = true;
			return;
		}
		this.loadingMarket = true;
		try {
			const oracle = await getOracleState(market);
			if (network !== this.network) return;
			// Show the price first; the order scan takes a few seconds more.
			this.oracle = oracle;
			this.oracleLoaded = true;
			const discovery = oracle ? await discoverOrders(market) : undefined;
			if (network !== this.network) return;
			this.discovery = discovery;
			this.lastFullMarketRefresh = Date.now();
			this.marketError = '';
		} catch (cause) {
			if (network === this.network) this.marketError = errorText(cause);
		} finally {
			this.loadingMarket = false;
		}
	}

	async refreshFeed() {
		try {
			const next = await fetchLatestOracleMessage(this.config.oraclePublicKey);
			if (this.feed && next.messageSequence !== this.feed.messageSequence) this.previousFeedPrice = oracleStateFromMessage(this.feed).price;
			this.feed = next;
			this.feedError = '';
		} catch (cause) {
			this.feedError = `oracles.cash price feed unavailable: ${errorText(cause)}`;
		}
	}

	async refreshAll() {
		await Promise.all([this.refreshWallet(), this.refreshMarket(), this.refreshFeed()]);
		await this.refreshHistory();
	}

	recordBroadcast(txid: string, unsigned: UnsignedExchangeTransaction | { kind: string; summary: string[] }) {
		this.history = [{ txid, kind: unsigned.kind, summary: unsigned.summary, at: Date.now(), status: 'broadcast' }, ...this.history];
		saveTxHistory(this.history, this.network);
		setTimeout(() => void this.refreshAll(), 2_500);
	}

	async refreshHistory() {
		// Any address on this network works for an Electrum lookup; the wallet need not be connected.
		const anyAddress = this.wallet?.address ?? (this.market ? marketOracleAddress(this.market) : undefined);
		if (!anyAddress) return;
		let changed = false;
		for (const record of this.history.filter((r) => r.status !== 'confirmed').slice(0, 10)) {
			const height = await transactionHeight(anyAddress, record.txid);
			const status = height === undefined ? 'unknown' : height > 0 ? 'confirmed' : 'broadcast';
			if (status !== record.status) {
				record.status = status;
				changed = true;
			}
		}
		if (changed) {
			this.history = [...this.history];
			saveTxHistory(this.history, this.network);
		}
	}
}

export const pp = new PennyPickerSession();

export function explorerTx(txid: string, network: NetworkId = pp.network): string {
	return NETWORKS[network].explorerTx(txid);
}

export function explorerAddress(address: string, network: NetworkId = pp.network): string {
	return NETWORKS[network].explorerAddress(address);
}

export function formatAge(seconds: number | undefined): string {
	if (seconds === undefined) return '—';
	if (seconds < 90) return `${seconds}s ago`;
	if (seconds < 90 * 60) return `${Math.round(seconds / 60)} min ago`;
	if (seconds < 48 * 3600) return `${Math.round(seconds / 3600)} h ago`;
	return `${Math.round(seconds / 86400)} d ago`;
}
