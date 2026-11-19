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
import type { ChainUtxo, MarketConfig, OracleUtxo, UnsignedExchangeTransaction } from '$lib/pennypicker/exchange';
import { makerPkhFromAddress } from '$lib/pennypicker/orderCommitment';
import { NETWORKS, type NetworkId } from '$lib/pennypicker/network';
import { markIdentityOutputs, type IdentityHead } from '$lib/pennypicker/identity';
import { balancesOf, errorText, type ConnectedWallet } from './wallet';

export const STALE_AFTER_SECONDS = 15 * 60;

/** Background poll cadence: a one-request change check (see poll()). */
const POLL_INTERVAL_MS = 5_000;
/** Full book reload even without activity, to pick up cancels (which do not touch the oracle address). */
const FULL_REFRESH_MS = 60_000;
const WALLET_REFRESH_MS = 30_000;

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
	/** The selected market can create orders and fills in this build. */
	canTrade = $derived(this.selectedMarket.status === 'live');

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
	identityError = $state('');
	loadingMarket = $state(false);
	marketError = $state('');
	history = $state<TxRecord[]>([]);
	nowSec = $state(Math.floor(Date.now() / 1000));
	lastRefreshed = $state<Date | undefined>();
	/** Number of open transaction dialogs; background refreshes pause while any is open. */
	txOpen = $state(0);
	/** Last time the background poll checked the market (read-only). */
	lastChecked = $state<Date | undefined>();

	market = $derived<MarketConfig | undefined>(isCompleteMarket(this.config) ? this.config : undefined);
	balances = $derived(balancesOf(this.utxos, this.config.pusdCategory));
	/** Latest signed BCH/USD message from oracles.cash (polled every minute). */
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
		setInterval(() => void this.refreshFeed(), 30_000);
		// Market data must not wait for the wallet: restoring a session asks Cashonize for its address, which can take a
		// long time when the wallet app is asleep. Load the book and price straight away, and the wallet in parallel.
		void this.refreshMarket().then(() => this.refreshHistory());
		void this.restoreSession().then(() => this.refreshWallet());
		setInterval(() => void this.poll(), POLL_INTERVAL_MS);
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') void this.poll();
		});
	}

	private polling = false;
	private lastFullMarketRefresh = 0;
	private lastWalletRefresh = 0;

	/**
	 * Read-only background refresh. Every few seconds it makes one cheap Electrum request (the oracle address
	 * history); the book is reloaded only when that changed, or once a minute to catch cancels. It never overlaps
	 * itself or a manual refresh, skips hidden tabs, and pauses while a transaction dialog is open. It only reads
	 * chain data: it builds, signs and broadcasts nothing, and it does not touch form input.
	 */
	private async poll() {
		if (this.polling || this.loadingMarket || this.txOpen > 0 || document.visibilityState !== 'visible') return;
		const market = this.market;
		if (!market || !this.oracleLoaded) return;
		this.polling = true;
		const network = this.network;
		try {
			const now = Date.now();
			const fingerprint = await marketActivityFingerprint(market);
			if (network !== this.network || this.txOpen > 0) return;
			const changed = fingerprint !== this.discovery?.fingerprint;
			if (changed || now - this.lastFullMarketRefresh > FULL_REFRESH_MS) {
				await this.refreshMarket();
				if (changed) await this.refreshWallet();
			} else if (this.wallet && now - this.lastWalletRefresh > WALLET_REFRESH_MS) {
				await this.refreshWallet();
			}
			this.lastChecked = new Date();
		} catch {
			/* transient network error: the next tick retries; manual Refresh still reports errors */
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
			await this.adopt(client, session);
		} catch (cause) {
			this.walletStatus = 'disconnected';
			this.walletError = describeWalletConnectError(cause);
		}
	}

	private async adopt(client: ConnectedWallet['client'], session: ConnectedWallet['session']) {
		const network = this.network;
		const [address] = await requestAddresses(client, session, NETWORKS[network].walletConnectChain);
		if (!address) throw new Error(`Cashonize returned no ${NETWORKS[network].label} address.`);
		// The user may have switched markets while Cashonize was answering.
		if (network !== this.network) return;
		this.wallet = { client, session, address, pkh: makerPkhFromAddress(address, network), network };
		this.walletStatus = 'connected';
		const clear = ({ topic }: { topic: string }) => {
			if (this.wallet?.session.topic === topic) this.forgetWallet();
		};
		client.on('session_delete', clear);
		client.on('session_expire', clear);
	}

	private forgetWallet() {
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
			await this.refreshWallet();
		} catch (cause) {
			this.pairingUri = '';
			this.walletStatus = this.wallet ? 'connected' : 'disconnected';
			this.walletError = describeWalletConnectError(cause);
		}
	}

	async disconnect() {
		if (!this.wallet) return;
		try {
			await disconnectCashonizeSession(this.wallet.client, this.wallet.session);
		} catch (cause) {
			this.walletError = describeWalletConnectError(cause);
		}
		this.forgetWallet();
	}

	async refreshWallet() {
		if (!this.wallet) return;
		this.loadingWallet = true;
		try {
			const raw = await getAddressUtxos(this.wallet.address);
			const category = this.config.pusdCategory;
			let head: IdentityHead | undefined;
			// Identity outputs only matter where this app mints or manages the token (Chipnet PUSD).
			const tracksIdentity = this.network === 'chipnet';
			if (category && tracksIdentity) {
				try {
					head = await getIdentityHead(category, this.wallet.address);
					this.identityError = '';
				} catch (cause) {
					this.identityError = `Could not resolve the PUSD identity output (${errorText(cause)}). All output-0 coins are held back until it resolves.`;
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
		if (!this.config.oracleCategory && this.config.oracleOperatorPkh) {
			try {
				const found = await discoverOracleCategory(this.config.oracleOperatorPkh, this.network);
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
			this.oracle = await getOracleState(market);
			this.oracleLoaded = true;
			this.discovery = this.oracle ? await discoverOrders(market) : undefined;
			this.lastRefreshed = new Date();
			this.lastFullMarketRefresh = Date.now();
			this.lastChecked = new Date();
			this.marketError = '';
		} catch (cause) {
			this.marketError = errorText(cause);
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
