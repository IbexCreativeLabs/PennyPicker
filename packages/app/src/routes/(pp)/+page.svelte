<script lang="ts">
	import TxFlow from '$lib/pennypicker/ui/TxFlow.svelte';
	import BpsScale from '$lib/pennypicker/ui/BpsScale.svelte';
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { pp, explorerTx, formatAge } from '$lib/pennypicker/ui/session.svelte';
	import { errorText, parseBch, parsePusd } from '$lib/pennypicker/ui/wallet';
	import {
		askFillUnitsDue,
		assertOrderDelta,
		bidSatsForUnits,
		formatPrice,
		limitPrice,
		oracleStateFromMessage
	} from '$lib/pennypicker/contracts';
	import {
		buildCancelOrder,
		buildCreateOrder,
		orderValueUnits,
		buildFillOrders,
		formatSats,
		formatUnits,
		MIN_TRADE_SATOSHIS,
		quoteLeg,
		type FillLeg,
		type OpenOrder,
		type OrderSide,
		type UnsignedExchangeTransaction
	} from '$lib/pennypicker/exchange';
	import { getOracleState } from '$lib/pennypicker/chain';

	let pending = $state<UnsignedExchangeTransaction | undefined>();
	let error = $state('');
	let mode = $state<'limit' | 'take'>('limit');

	// Maker
	let side = $state<OrderSide>('ask');
	let bpsInput = $state('50');
	let amountInput = $state('0.01');

	// Taker
	let takeSide = $state<'buy' | 'sell'>('buy');
	let takeAmount = $state('0.01');
	let pinned = $state<OpenOrder | undefined>();

	// Keep the book and balances live only while the Exchange is open (and the tab visible).
	onMount(() => pp.watchMarket());

	const price = $derived(pp.price);
	const sym = $derived(pp.selectedMarket.symbol);
	const myPkh = $derived(pp.wallet?.pkh);
	const live = $derived((pp.discovery?.orders ?? []).filter((o) => !o.exhausted));
	const asks = $derived(live.filter((o) => o.side === 'ask').sort((a, b) => b.deltaBps - a.deltaBps));
	const bids = $derived(live.filter((o) => o.side === 'bid').sort((a, b) => b.deltaBps - a.deltaBps));
	const bestAsk = $derived(asks.at(-1));
	const bestBid = $derived(bids[0]);
	const myOrders = $derived((pp.discovery?.orders ?? []).filter((o) => o.makerPkh === myPkh));

	const bidSizeSats = (o: OpenOrder) => (price ? bidSatsForUnits(o.availableUnits, price, o.deltaBps) : 0n);
	const sizeSats = (o: OpenOrder) => (o.side === 'ask' ? o.availableSats : bidSizeSats(o));

	// "Try this example" links (e.g. /?side=bid&bps=-50) pre-fill the limit-order form. Nothing is built or signed.
	// Reacts to the URL, so it also works when the link is clicked while already on the Exchange.
	$effect(() => {
		const params = page.url.searchParams;
		const wanted = params.get('side');
		const bps = params.get('bps');
		if (wanted !== 'bid' && wanted !== 'ask') return;
		untrack(() => {
			mode = 'limit';
			setSide(wanted);
			if (bps && /^-?\d{1,4}$/.test(bps)) bpsInput = bps;
			replaceState('/', {});
			requestAnimationFrame(() => document.querySelector('.trade')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
		});
	});

	function setSide(next: OrderSide) {
		side = next;
		const n = Number(bpsInput);
		if (Number.isFinite(n) && n !== 0) bpsInput = String(next === 'ask' ? Math.abs(n) : -Math.abs(n));
		amountInput = next === 'ask' ? '0.01' : '5.00';
	}

	/** Mainnet safety cap (same rule the transaction builder enforces). */
	const cap = $derived(pp.market?.maxOrderUnits ?? pp.selectedMarket.maxOrderUnits);
	function assertCap(orderSide: OrderSide, amount: bigint, limit: bigint) {
		if (cap === undefined) return;
		const value = orderValueUnits(orderSide, amount, limit);
		if (value > cap) throw new Error(`Orders are limited to ${formatUnits(cap)} ${sym} each on this market (this one is worth ${formatUnits(value)} ${sym}).`);
	}

	const maker = $derived.by(() => {
		if (!price) return { error: pp.oracleLoaded && pp.feedError ? 'No reference price available right now.' : 'Loading the live oracle price…' };
		try {
			if (!/^-?\d+$/.test(bpsInput.trim())) throw new Error('BPS must be a whole number.');
			const delta = Number(bpsInput);
			assertOrderDelta(side, delta);
			const limit = limitPrice(price, delta);
			if (side === 'ask') {
				const sats = parseBch(amountInput);
				if (sats < MIN_TRADE_SATOSHIS) throw new Error(`Minimum ask is ${formatSats(MIN_TRADE_SATOSHIS)} BCH.`);
				assertCap('ask', sats, limit);
				return { delta, limit, sats, units: askFillUnitsDue(sats, price, delta) };
			}
			const units = parsePusd(amountInput);
			if (units <= 0n) throw new Error(`Enter a ${sym} amount.`);
			assertCap('bid', units, limit);
			return { delta, limit, units, sats: bidSatsForUnits(units, price, delta) };
		} catch (cause) {
			return { error: errorText(cause) };
		}
	});

	const route = $derived.by(() => {
		if (!price) return undefined;
		try {
			let want = parseBch(takeAmount);
			if (want <= 0n) return undefined;
			const book = pinned ? [pinned] : takeSide === 'buy' ? [...asks].reverse() : bids;
			const legs: FillLeg[] = [];
			let units = 0n;
			let sats = 0n;
			for (const order of book) {
				if (want < MIN_TRADE_SATOSHIS) break;
				if (order.makerPkh === myPkh) continue;
				let take = sizeSats(order) < want ? sizeSats(order) : want;
				if (take < MIN_TRADE_SATOSHIS) continue;
				let quote;
				while (take >= MIN_TRADE_SATOSHIS) {
					try {
						quote = quoteLeg({ order, sats: take }, price);
						break;
					} catch {
						take -= 1n;
					}
				}
				if (!quote) continue;
				legs.push({ order, sats: take });
				units += quote.units;
				sats += take;
				want -= take;
			}
			const limits = legs.map((leg) => limitPrice(price, leg.order.deltaBps));
			return { legs, units, sats, unfilled: want, best: limits[0] ?? 0n, worst: limits[limits.length - 1] ?? 0n };
		} catch {
			return undefined;
		}
	});

	async function prepare(build: () => UnsignedExchangeTransaction) {
		error = '';
		try {
			if (!pp.wallet) throw new Error('Connect a wallet first.');
			if (!pp.market) throw new Error('Market is not configured.');
			await Promise.all([pp.refreshWallet(), pp.refreshFeed()]);
			const latest = await getOracleState(pp.market);
			if (!latest) throw new Error('Oracle state not found; refresh the market.');
			pp.oracle = latest;
			pending = build();
		} catch (cause) {
			error = errorText(cause);
		}
	}

	/** Repeats the last action against fresh chain state (after a broadcast conflict). */
	let retry: (() => void) | undefined;
	async function rebuild() {
		pending = undefined;
		await pp.refreshMarket();
		retry?.();
	}
	const freshOrder = (order: OpenOrder) => (pp.discovery?.orders ?? []).find((o) => o.lockingBytecodeHex === order.lockingBytecodeHex && !o.exhausted);

	function placeOrder() {
		retry = placeOrder;
		void prepare(() => {
			if ('error' in maker) throw new Error(maker.error);
			return buildCreateOrder(pp.market!, pp.oracle!, pp.wallet!.address, pp.wallet!.pkh, pp.utxos, {
				side,
				deltaBps: maker.delta,
				amount: side === 'ask' ? maker.sats : maker.units
			}, pp.refreshMessage);
		});
	}

	function takeRoute() {
		retry = () => {
			if (pinned) {
				pinned = freshOrder(pinned);
				if (!pinned) {
					error = 'That order was filled or canceled in the meantime. Pick another order from the book.';
					return;
				}
			}
			takeRoute();
		};
		const r = route;
		void prepare(() => {
			if (!r || r.legs.length === 0) throw new Error('No fillable orders for that amount.');
			return buildFillOrders(pp.market!, pp.oracle!, pp.wallet!.address, pp.utxos, r.legs, pp.refreshMessage);
		});
	}

	function pin(order: OpenOrder) {
		mode = 'take';
		pinned = order;
		takeSide = order.side === 'ask' ? 'buy' : 'sell';
		takeAmount = formatSats(sizeSats(order));
	}

	function cancel(order: OpenOrder) {
		retry = () => {
			const fresh = freshOrder(order);
			if (fresh) cancel(fresh);
			else error = 'This order is no longer open, so there is nothing to cancel.';
		};
		void prepare(() => buildCancelOrder(pp.market!, order, pp.wallet!.address, pp.utxos));
	}

	function broadcasted(txid: string, unsigned: UnsignedExchangeTransaction) {
		pp.recordBroadcast(txid, unsigned);
		pinned = undefined;
	}

	const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

	// Depth bars: each row's size relative to the largest order on the book (in sats).
	const maxDepth = $derived([...asks.map((o) => o.availableSats), ...bids.map((o) => bidSizeSats(o))].reduce((m, v) => (v > m ? v : m), 1n));
	const depth = (sats: bigint) => `${Math.max(4, Math.min(100, Number((sats * 100n) / maxDepth)))}%`;

	// Direction of the last oracle move (current feed vs the message before it).
	const move = $derived.by(() => {
		const now = pp.feed ? oracleStateFromMessage(pp.feed).price : undefined;
		const before = pp.previousFeedPrice;
		if (!now || !before || now === before) return undefined;
		// Change in basis points (1 BPS = 0.01%), with one decimal.
		const bps = Number(((now - before) * 100_000n) / before) / 10;
		return { up: now > before, label: `${now > before ? '▲' : '▼'} ${Math.abs(bps).toFixed(1)} BPS` };
	});

	// Getting-started guide for visitors without a funded, connected wallet.
	let guideHidden = $state(false);
	$effect(() => {
		try {
			guideHidden = localStorage.getItem('pennypicker:guide-hidden') === '1';
		} catch {
			/* storage unavailable */
		}
	});
	function hideGuide() {
		guideHidden = true;
		try {
			localStorage.setItem('pennypicker:guide-hidden', '1');
		} catch {
			/* storage unavailable */
		}
	}
	const mainnet = $derived(pp.networkInfo.realFunds);
	/** True until the first orderbook scan finishes (so empty-book messages are never shown before data arrives). */
	const bookLoading = $derived(!pp.discovery && !(pp.oracleLoaded && !pp.oracle) && !pp.marketError);
	const scaleOrders = $derived(live.map((o) => ({ deltaBps: o.deltaBps, side: o.side })));
	const draft = $derived(mode === 'limit' && !('error' in maker) ? { deltaBps: maker.delta, side } : undefined);
	const funded = $derived(!!pp.wallet && pp.utxosLoaded && pp.balances.bchSats > 0n);
	const showGuide = $derived(!guideHidden && !funded);

	const kindLabel: Record<string, string> = {
		'order-create': 'Order placed',
		'order-fill': 'Trade',
		'order-cancel': 'Order canceled',
		'oracle-update': 'Price update',
		'oracle-genesis': 'Oracle created',
		'pusd-send': 'Tokens sent',
		'pusd-genesis': 'Token created',
		'identity-separation': 'Identity separated',
		'bcmr-publication': 'Metadata published'
	};
	const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
	const quickBps = $derived(side === 'ask' ? [0, 10, 25, 50, 100] : [0, -10, -25, -50, -100]);
</script>

<svelte:head><title>Exchange · PennyPicker</title></svelte:head>

<main class="pp-container">
	{#if pp.selectedMarket.status !== 'live'}
	<section class="pp-card mainnet">
		<div class="pp-card-head">
			<h1>BCH / {pp.selectedMarket.name}</h1>
			<span class="pp-badge warn">{pp.networkInfo.label} · view only</span>
		</div>
		<p>{pp.selectedMarket.summary}</p>
		<div class="vo-stats">
			<div>
				<div class="pp-stat-label">Reference (oracles.cash)</div>
				<div class="pp-stat-value">{pp.displayPrice ? formatPrice(pp.displayPrice) : '—'}</div>
				<div class="small muted">{pp.feed ? `message #${pp.feed.messageSequence}` : pp.feedError || 'loading…'}</div>
			</div>
			{#if pp.selectedMarket.maxOrderUnits !== undefined}
				<div>
					<div class="pp-stat-label">Per-order cap</div>
					<div class="pp-stat-value">{formatUnits(pp.selectedMarket.maxOrderUnits)} {sym}</div>
					<div class="small muted">until the contracts are reviewed</div>
				</div>
			{/if}
			{#if pp.wallet}
				<div>
					<div class="pp-stat-label">Your balance</div>
					<div class="pp-stat-value">{formatUnits(pp.balances.pusdUnits)} {sym}</div>
					<div class="small muted">{formatSats(pp.balances.bchSats)} BCH</div>
				</div>
			{/if}
		</div>
		<p class="pp-callout warn small">
			<strong>Trading is not open yet.</strong> {pp.selectedMarket.statusReason ?? ''}
			The order covenants are the same ones running on Chipnet and use the same oracles.cash BCH/USD oracle as {pp.selectedMarket.name}.
		</p>
		<div class="pp-row">
			<button class="pp-btn pp-btn-primary" type="button" onclick={() => pp.selectMarket('pennypickerusd')}>Trade the Chipnet market (PennyPickerUSD)</button>
			<a class="pp-btn" href="/about/token">Token details</a>
			{#each pp.selectedMarket.links as link (link.href)}<a class="pp-btn" href={link.href} target="_blank" rel="noopener">{link.label} ↗</a>{/each}
		</div>
	</section>
	{:else}
	<section class="hero">
		<div class="hero-copy">
			<h1 class="slogan"><span class="paved">Don’t pick up pennies in front of the steamroller</span></h1>
			<p class="hero-sub">
				A fixed-price limit order gets flattened the moment BCH moves. On PennyPicker you set your price in
				<strong>basis points</strong> from the live BCH/USD oracle, so every order rolls along with the market.
			</p>
			<p class="hero-eg num">+25 BPS = 0.25% above the oracle price{#if price}{' · '}{formatPrice(limitPrice(price, 25))} {sym}/BCH right now{/if}</p>
			<div class="hero-cta">
				<a class="pp-btn pp-btn-primary" href="#trade">Place an order</a>
				<a class="pp-btn" href="/about">How it works</a>
			</div>
		</div>
		<div class="hero-art" aria-hidden="true">
			<img src="/steamroller-880.webp" alt="" width="440" height="440" fetchpriority="high" />
		</div>
	</section>

	{#if pp.networkInfo.realFunds}
		<p class="pp-callout bad small" style="margin-bottom: 1rem"><strong>BCH mainnet: real money.</strong> The contracts have had an internal security review only, no independent audit. Only trade amounts you can afford to lose.</p>
	{/if}
	{#if showGuide}
		<section class="pp-plain guide">
			<div class="pp-card-head">
				<h2>Start trading in three steps</h2>
				<button class="pp-btn pp-btn-ghost pp-btn-sm" type="button" onclick={hideGuide}>Hide</button>
			</div>
			<ol class="pp-steps">
				<li class:done={!!pp.wallet}>
					<strong>Get a wallet</strong>
					<span class="small muted">Open <a href="https://cashonize.com" target="_blank" rel="noopener">cashonize.com</a> and switch it to {mainnet ? 'Mainnet' : 'Chipnet'} in Settings.</span>
				</li>
				<li class:done={!!pp.wallet}>
					<strong>Connect</strong>
					<span class="small muted">{#if pp.wallet}Connected.{:else}WalletConnect, or WizardConnect for HD wallets.{/if}</span>
					{#if !pp.wallet}<div style="margin-top: 0.45rem"><a class="pp-btn pp-btn-primary pp-btn-sm" href="/wallet">Connect wallet</a></div>{/if}
				</li>
				<li class:done={funded}>
					{#if mainnet}
						<strong>Fund it</strong>
						<span class="small muted">A little BCH or {pp.selectedMarket.name}. Orders are capped at {formatUnits(pp.selectedMarket.maxOrderUnits ?? 0n)} {sym}.</span>
					{:else}
						<strong>Get test BCH</strong>
						<span class="small muted">Free from the <a href="https://tbch.googol.cash" target="_blank" rel="noopener">Chipnet faucet</a>. Sell some BCH below to get {sym}.</span>
					{/if}
				</li>
			</ol>
		</section>
	{/if}

	<!-- Market: price, freshness, best bid/ask and the live BPS diagram -->
	<section class="pp-card market">
		<div class="m-row">
			<div class="pair">
				<img class="coin" src={pp.selectedMarket.id === 'pennypickerusd' ? '/ppusd-256.png' : '/pennypicker-128.png'} alt="" width="40" height="40" />
				<div>
					<h2 class="pair-h">BCH <span class="faint">/</span> {sym}</h2>
					<span class="small muted">{pp.selectedMarket.name} · {pp.networkInfo.label}</span>
				</div>
			</div>
			<div class="m-stat">
				<div class="pp-stat-label"><span class="pp-live"></span> Oracle price</div>
				<div class="pp-stat-value">{#if price}{formatPrice(price)}{:else}<span class="skel" style="width: 5.5rem"></span>{/if}</div>
				<div class="small muted">{sym} per BCH {#if move}<span class={move.up ? 'bid-c' : 'ask-c'}>{move.label}</span>{/if}</div>
			</div>
			<div class="m-stat fresh">
				<div class="pp-stat-label">Freshness</div>
				{#if pp.oracle}
					<span class="pp-badge {pp.oracleStale ? 'warn' : 'ok'}">{pp.oracleStale ? 'Stale' : 'Fresh'}</span>
					<div class="small muted">{formatAge(pp.oracleAge)} · #{pp.oracle.state.sequence}</div>
				{:else if pp.oracleLoaded}
					<span class="pp-badge warn">No oracle</span>
				{:else}
					<span class="pp-badge plain">Loading…</span>
				{/if}
			</div>
			<div class="m-stat">
				<div class="pp-stat-label">Best bid / ask</div>
				{#if bookLoading}
					<div class="num"><span class="skel" style="width: 7rem"></span></div>
					<div class="small muted">Loading the book…</div>
				{:else}
					<div class="num m-best">
						<span class="bid-c">{bestBid && price ? formatPrice(limitPrice(price, bestBid.deltaBps)) : '—'}</span>
						<span class="faint">/</span>
						<span class="ask-c">{bestAsk && price ? formatPrice(limitPrice(price, bestAsk.deltaBps)) : '—'}</span>
					</div>
					<div class="small muted">{bestBid ? signed(bestBid.deltaBps) : '—'} / {bestAsk ? signed(bestAsk.deltaBps) : '—'} BPS</div>
				{/if}
			</div>
		</div>
		<div class="m-viz">
			<BpsScale {price} orders={scaleOrders} {draft} loading={!price} />
		</div>
	</section>

	{#if !pp.market}
		<p class="pp-callout warn">The market is not configured yet. Set the token and oracle IDs in <code>deployment.ts</code> or <code>VITE_PENNYPICKER_*</code>.</p>
	{:else if pp.oracleLoaded && !pp.oracle}
		<p class="pp-callout warn">No oracle state found on-chain. Trading opens once the oracle is created on <a href="/about/oracle">Oracle</a>.</p>
	{:else if pp.oracleStale}
		<p class="pp-callout warn small">{pp.feed ? 'The oracles.cash price' : 'The on-chain reference'} is {formatAge(pp.oracleAge)} old{pp.feedError ? ` (${pp.feedError})` : ''}. Fills settle at the newest signed price available.</p>
	{/if}
	{#if pp.marketError}<p class="pp-error">{pp.marketError}</p>{/if}

	{#if pending && pp.wallet}
		<TxFlow unsigned={pending} wallet={pp.wallet} onBroadcast={broadcasted} onDismiss={() => (pending = undefined)} onRebuild={rebuild} />
	{/if}
	{#if error}<p class="pp-callout bad">{error}</p>{/if}

	<div class="main-grid">
		<!-- Orderbook -->
		<section class="pp-card book">
			<div class="pp-card-head">
				<h2>Floating order book</h2>
				<span class="small muted">Every price moves with the oracle</span>
			</div>
			<div class="pp-table-wrap">
				<table class="pp-table">
					<thead><tr><th>BPS</th><th class="r">Price</th><th class="r">Size BCH</th><th class="r">Total {sym}</th><th></th></tr></thead>
					<tbody>
						{#each asks as order (order.address)}
							{@const l = price ? limitPrice(price, order.deltaBps) : 0n}
							<tr class="ask-row" class:mine={order.makerPkh === myPkh} style="--depth: {depth(order.availableSats)}">
								<td class="ask-c">{signed(order.deltaBps)}</td>
								<td class="r ask-c">{price ? formatPrice(l) : '—'}</td>
								<td class="r">{formatSats(order.availableSats)}</td>
								<td class="r muted">{price ? formatUnits(askFillUnitsDue(order.availableSats, price, order.deltaBps)) : '—'}</td>
								<td class="r">
									{#if order.makerPkh === myPkh}<span class="pp-badge plain small">yours</span>
									{:else if pp.wallet}<button class="pp-btn pp-btn-sm" type="button" onclick={() => pin(order)}>Buy</button>{/if}
								</td>
							</tr>
						{:else}
							{#if bookLoading}
								{#each [0, 1, 2] as i (i)}<tr class="skel-row"><td colspan="5"><span class="skel" style="width: {70 - i * 8}%"></span></td></tr>{/each}
							{:else}
								<tr><td colspan="5" class="muted small">No asks (nobody selling BCH yet).</td></tr>
							{/if}
						{/each}
						<tr class="ref-row">
							<td colspan="5">
								<span><span class="pp-live"></span> Reference <strong class="num">{price ? formatPrice(price) : 'loading…'}</strong> {sym}/BCH</span>
								{#if bestAsk && bestBid}<span class="muted small"> · spread {bestAsk.deltaBps - bestBid.deltaBps} BPS</span>{/if}
							</td>
						</tr>
						{#each bids as order (order.address)}
							{@const l = price ? limitPrice(price, order.deltaBps) : 0n}
							<tr class="bid-row" class:mine={order.makerPkh === myPkh} style="--depth: {depth(bidSizeSats(order))}">
								<td class="bid-c">{signed(order.deltaBps)}</td>
								<td class="r bid-c">{price ? formatPrice(l) : '—'}</td>
								<td class="r">{formatSats(bidSizeSats(order))}</td>
								<td class="r muted">{formatUnits(order.availableUnits)}</td>
								<td class="r">
									{#if order.makerPkh === myPkh}<span class="pp-badge plain small">yours</span>
									{:else if pp.wallet}<button class="pp-btn pp-btn-sm" type="button" onclick={() => pin(order)}>Sell</button>{/if}
								</td>
							</tr>
						{:else}
							{#if bookLoading}
								{#each [0, 1, 2] as i (i)}<tr class="skel-row"><td colspan="5"><span class="skel" style="width: {54 + i * 8}%"></span></td></tr>{/each}
							{:else}
								<tr><td colspan="5" class="muted small">No bids (nobody buying BCH yet).</td></tr>
							{/if}
						{/each}
					</tbody>
				</table>
			</div>
			{#if bookLoading}
				<p class="small faint">Scanning the chain for orders…</p>
			{:else if pp.discovery}
				<p class="small faint">{pp.discovery.announcedCount} orders announced · {pp.discovery.fills.length} fills · {pp.discovery.canceled.length} canceled{pp.discovery.historyTruncated ? ' · older history not scanned' : ''}</p>
			{/if}
		</section>

		<!-- Trade panel -->
		<section class="pp-card trade" id="trade">
			<div class="pp-seg" role="tablist">
				<button type="button" class:on={mode === 'limit'} onclick={() => (mode = 'limit')}>Limit order</button>
				<button type="button" class:on={mode === 'take'} onclick={() => (mode = 'take')}>Trade now</button>
			</div>

			{#if !pp.wallet}
				<p class="pp-callout small" style="margin-top: 0.85rem">Connect a wallet to trade. <a href="/wallet">Connect →</a></p>
			{/if}

			{#if mode === 'limit'}
				<div class="pp-stack form">
					<div class="pp-seg">
						<button type="button" class="bid" class:on={side === 'bid'} onclick={() => setSide('bid')}>Buy BCH</button>
						<button type="button" class="ask" class:on={side === 'ask'} onclick={() => setSide('ask')}>Sell BCH</button>
					</div>
					<label class="pp-field">
						<span>Deviation from reference</span>
						<div class="pp-input-group"><input class="pp-input" inputmode="numeric" bind:value={bpsInput} /><span class="pp-addon">BPS</span></div>
					</label>
					<div class="chips">
						{#each quickBps as q}<button type="button" class="pp-btn pp-btn-sm" class:sel={String(q) === bpsInput.trim()} onclick={() => (bpsInput = String(q))}>{signed(q)}</button>{/each}
					</div>
					<label class="pp-field">
						<span>{side === 'ask' ? 'Amount of BCH to sell' : `${sym} to spend`}</span>
						<div class="pp-input-group"><input class="pp-input" inputmode="decimal" bind:value={amountInput} /><span class="pp-addon">{side === 'ask' ? 'BCH' : sym}</span></div>
					</label>

					{#if 'error' in maker}
						<p class="pp-error small">{maker.error}</p>
					{:else if price}
						<div class="calc">
							<div><span class="muted">Reference</span><span class="num">{formatPrice(price)}</span></div>
							<div><span class="muted">Deviation</span><span class="num">{signed(maker.delta)} BPS ({pct(maker.delta)})</span></div>
							<div class="lim"><span>Limit price now</span><strong class="num {side === 'ask' ? 'ask-c' : 'bid-c'}">{formatPrice(maker.limit, 2)} {sym}/BCH</strong></div>
							<div><span class="muted">{side === 'ask' ? 'You receive ≈' : 'You buy ≈'}</span><span class="num">{side === 'ask' ? `${formatUnits(maker.units)} ${sym}` : `${formatSats(maker.sats)} BCH`}</span></div>
						</div>
						<p class="pp-hint">The limit moves with the reference: the order always trades at {pct(Math.abs(maker.delta))} {maker.delta >= 0 ? 'above' : 'below'} the latest published price.</p>
					{/if}
					{#if pp.networkInfo.realFunds}
						<p class="pp-callout bad small">Real money on BCH mainnet. Contracts not independently audited{cap !== undefined ? `; orders capped at ${formatUnits(cap)} ${sym}` : ''}.</p>
					{/if}
					<button type="button" class="pp-btn pp-btn-block {side === 'ask' ? 'pp-btn-ask' : 'pp-btn-bid'}" onclick={placeOrder} disabled={!pp.wallet || !pp.oracle || 'error' in maker}>
						Review {side === 'ask' ? 'sell' : 'buy'} order
					</button>
				</div>
			{:else}
				<div class="pp-stack form">
					<div class="pp-seg">
						<button type="button" class="bid" class:on={takeSide === 'buy'} onclick={() => { takeSide = 'buy'; pinned = undefined; }}>Buy BCH</button>
						<button type="button" class="ask" class:on={takeSide === 'sell'} onclick={() => { takeSide = 'sell'; pinned = undefined; }}>Sell BCH</button>
					</div>
					<label class="pp-field">
						<span>Amount of BCH to {takeSide}</span>
						<div class="pp-input-group"><input class="pp-input" inputmode="decimal" bind:value={takeAmount} /><span class="pp-addon">BCH</span></div>
					</label>
					{#if pinned}
						<p class="small">Filling one order at {signed(pinned.deltaBps)} BPS · <button class="pp-btn pp-btn-ghost pp-btn-sm" type="button" onclick={() => (pinned = undefined)}>use best prices instead</button></p>
					{/if}
					{#if route && route.legs.length}
						<div class="calc">
							<div><span class="muted">Orders matched</span><span class="num">{route.legs.length}</span></div>
							<div><span class="muted">Limit price</span><span class="num">{formatPrice(route.best)}{route.worst !== route.best ? ` – ${formatPrice(route.worst)}` : ''} {sym}/BCH</span></div>
							<div class="lim"><span>{takeSide === 'buy' ? 'You pay' : 'You receive'}</span><strong class="num">{formatUnits(route.units)} {sym}</strong></div>
							<div><span class="muted">{takeSide === 'buy' ? 'You receive' : 'You sell'}</span><span class="num">{formatSats(route.sats)} BCH</span></div>
						</div>
						<p class="small muted">Token amounts are rounded to 0.01 in the order maker's favour.</p>
						{#if route.unfilled >= MIN_TRADE_SATOSHIS}<p class="pp-callout warn small">{formatSats(route.unfilled)} BCH cannot be matched from the current book.</p>{/if}
					{:else}
						<p class="small muted">{takeSide === 'buy' ? 'No asks available to buy from.' : 'No bids available to sell into.'}</p>
					{/if}
					<p class="pp-hint">Prices settle against the reference at the moment the transaction confirms the oracle state it reads.</p>
					<button type="button" class="pp-btn pp-btn-block {takeSide === 'buy' ? 'pp-btn-bid' : 'pp-btn-ask'}" onclick={takeRoute} disabled={!pp.wallet || !pp.oracle || !route?.legs.length}>
						Review trade
					</button>
				</div>
			{/if}
		</section>
	</div>

	<!-- My orders -->
	{#if pp.wallet}
		<section class="pp-plain section">
			<div class="pp-card-head"><h2>My orders</h2><span class="small muted">{#if pp.utxosLoaded}Balances: {formatSats(pp.balances.bchSats)} BCH · {formatUnits(pp.balances.pusdUnits)} {sym}{:else}Loading balances…{/if}</span></div>
			<div class="pp-table-wrap">
				<table class="pp-table">
					<thead><tr><th>Side</th><th>BPS</th><th class="r">Limit now</th><th class="r">Remaining</th><th class="r">Proceeds</th><th>Status</th><th></th></tr></thead>
					<tbody>
						{#each myOrders as order (order.address)}
							<tr>
								<td class={order.side === 'ask' ? 'ask-c' : 'bid-c'}>{order.side === 'ask' ? 'Sell BCH' : 'Buy BCH'}</td>
								<td>{signed(order.deltaBps)}</td>
								<td class="r">{price ? formatPrice(limitPrice(price, order.deltaBps)) : '—'}</td>
								<td class="r">{order.side === 'ask' ? `${formatSats(order.availableSats)} BCH` : `${formatUnits(order.availableUnits)} ${sym}`}</td>
								<td class="r">{order.side === 'ask' ? `${formatUnits(order.proceeds)} ${sym}` : `${formatSats(order.proceeds)} BCH`}</td>
								<td>
									<span class="pp-badge {order.exhausted ? 'plain' : 'ok'}">{order.exhausted ? 'Filled' : 'Open'}</span>
									{#if (order.utxo.height ?? 0) <= 0}<span class="pp-badge warn">unconfirmed</span>{/if}
								</td>
								<td class="r"><button class="pp-btn pp-btn-sm" type="button" onclick={() => cancel(order)}>{order.exhausted ? 'Withdraw' : 'Cancel'}</button></td>
							</tr>
						{:else}
							<tr><td colspan="7" class="muted small">{bookLoading ? 'Loading your orders…' : 'You have no orders on this market.'}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	<!-- Activity -->
	<div class="pp-grid-2 section">
		<section class="pp-plain">
			<h2>Your transactions</h2>
			{#each pp.history.slice(0, 8) as record (record.txid)}
				<div class="tx">
					<span class="pp-badge {record.status === 'confirmed' ? 'ok' : record.status === 'broadcast' ? 'warn' : 'plain'}">{record.status}</span>
					<span class="grow"><strong>{kindLabel[record.kind] ?? record.kind}</strong><br /><span class="small muted">{record.summary[0]}</span></span>
					<a class="small" href={explorerTx(record.txid)} target="_blank" rel="noopener">{record.txid.slice(0, 8)}… ↗</a>
				</div>
			{:else}
				<p class="small muted">Nothing yet. Transactions you broadcast from this browser appear here.</p>
			{/each}
		</section>
		<section class="pp-plain">
			<h2>Market fills</h2>
			{#each (pp.discovery?.fills ?? []).slice(0, 8) as fill (fill.txid)}
				<div class="tx">
					<span class="pp-badge {fill.height > 0 ? 'ok' : 'warn'}">{fill.height > 0 ? `block ${fill.height}` : 'mempool'}</span>
					<span class="grow"><strong>Trade</strong><br /><span class="mono small muted">{fill.txid.slice(0, 16)}…</span></span>
					<a class="small" href={explorerTx(fill.txid)} target="_blank" rel="noopener">View ↗</a>
				</div>
			{:else}
				<p class="small muted">{bookLoading ? 'Loading fills…' : 'No fills observed on this market yet.'}</p>
			{/each}
		</section>
	</div>
	{/if}
</main>

<style>
	/* Hero: the steamroller paves the slogan (left to right) on wide screens. */
	.hero { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.75fr); gap: 1rem 2.5rem; align-items: center; margin: 0.75rem 0 2rem; }
	.slogan { font-size: clamp(2rem, 4.6vw, 3.4rem); line-height: 1.06; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 0.9rem; max-width: 15ch; }
	.paved { display: inline; background: linear-gradient(transparent 62%, color-mix(in srgb, var(--pp-brand) 55%, transparent) 62%, color-mix(in srgb, var(--pp-brand) 55%, transparent) 92%, transparent 92%); background-repeat: no-repeat; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
	.hero-sub { color: var(--pp-muted); font-size: 1.08rem; line-height: 1.6; margin: 0 0 0.6rem; max-width: 34rem; }
	.hero-eg { font-size: 0.92rem; color: var(--pp-text); margin: 0 0 1.1rem; }
	.hero-cta { display: flex; flex-wrap: wrap; gap: 0.6rem; }
	.hero-art { position: relative; justify-self: center; width: min(100%, 25rem); }
	.hero-art img { display: block; width: 100%; height: auto; filter: drop-shadow(0 18px 30px rgba(30, 27, 29, 0.18)); }
	.hero-art::after { content: ''; position: absolute; left: 12%; right: 12%; bottom: -0.4rem; height: 1.1rem; border-radius: 50%; background: radial-gradient(closest-side, rgba(30, 27, 29, 0.18), transparent); z-index: -1; }
	@media (prefers-reduced-motion: no-preference) {
		.hero-art img { animation: roll-in 1.5s var(--pp-ease) both, rumble 0.22s 1.5s ease-in-out 3; }
		.slogan .paved { animation: pave 1.5s var(--pp-ease) both; }
		.hero-sub, .hero-eg, .hero-cta { animation: rise 0.6s 0.9s var(--pp-ease) both; }
	}
	@keyframes roll-in { from { transform: translateX(-140%); } }
	@keyframes rumble { 50% { transform: translateY(-2px) rotate(-0.6deg); } }
	@keyframes pave { from { clip-path: inset(-0.2em 100% -0.2em 0); } to { clip-path: inset(-0.2em 0 -0.2em 0); } }
	@keyframes rise { from { opacity: 0; transform: translateY(8px); } }
	@media (max-width: 760px) {
		.hero { grid-template-columns: minmax(0, 1fr); margin-top: 0.25rem; }
		.hero-art { grid-row: 1; width: min(62%, 15rem); justify-self: start; }
		@keyframes roll-in { from { transform: translateX(-60%); opacity: 0; } }
	}

	.skel { display: inline-block; height: 0.9em; min-width: 2rem; border-radius: 6px; background: linear-gradient(90deg, var(--pp-surface-2), var(--pp-border-strong), var(--pp-surface-2)); background-size: 200% 100%; animation: shimmer 1.2s linear infinite; vertical-align: middle; }
	.skel-row td { padding: 0.55rem 0.5rem; }
	@keyframes shimmer { to { background-position: -200% 0; } }
	@media (prefers-reduced-motion: reduce) { .skel { animation: none; } }
	.mainnet h1 { font-size: 1.4rem; margin: 0; }
	.mainnet .pp-row { margin-top: 0.75rem; flex-wrap: wrap; }
	.vo-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: 0.9rem; margin: 0.9rem 0; }

	.guide { margin-bottom: 1.5rem; }
	.guide h2 { font-size: 1.1rem; }

	.market { margin-bottom: 1.25rem; }
	.m-row { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem 2.5rem; }
	.m-viz { margin-top: 0.9rem; padding-top: 0.6rem; box-shadow: 0 -1px 0 var(--pp-border); }
	.pair { margin-right: auto; display: flex; align-items: center; gap: 0.75rem; }
	.pair-h { font-size: 1.5rem; margin: 0; }
	.coin { width: 40px; height: 40px; border-radius: 50%; flex: none; }
	.m-stat { min-width: 7rem; font-variant-numeric: tabular-nums; }
	.m-stat.fresh { width: 9rem; }
	.m-stat .pp-stat-value { font-size: 1.45rem; }
	.m-best { font-size: 1.05rem; font-weight: 600; }

	.main-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(18rem, 1fr); gap: 1.25rem; align-items: start; }
	@media (max-width: 900px) { .main-grid { grid-template-columns: 1fr; } }
	.trade { position: sticky; top: 5rem; scroll-margin-top: 5rem; }
	@media (max-width: 900px) { .trade { position: static; } }
	.form { margin-top: 0.9rem; }
	.chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
	.chips .sel { border-color: var(--pp-brand); background: var(--pp-accent-soft); }
	.calc { border-radius: var(--pp-radius-sm); padding: 0.65rem 0.8rem; background: var(--pp-surface-2); font-size: 0.9rem; }
	.calc > div { display: flex; justify-content: space-between; gap: 0.5rem; padding: 0.15rem 0; }
	.calc .lim { box-shadow: 0 -1px 0 var(--pp-border), 0 1px 0 var(--pp-border); margin: 0.3rem 0; padding: 0.4rem 0; }
	.ask-c { color: var(--pp-ask); }
	.bid-c { color: var(--pp-bid); }
	tr.ask-row { background: linear-gradient(to left, var(--pp-ask-soft) var(--depth, 0%), transparent var(--depth, 0%)); }
	tr.bid-row { background: linear-gradient(to left, var(--pp-bid-soft) var(--depth, 0%), transparent var(--depth, 0%)); }
	tr.ask-row:hover, tr.bid-row:hover { filter: brightness(0.97); }
	tr.mine { background: var(--pp-accent-soft); }
	tr.ref-row td { background: var(--pp-surface-2); text-align: center; padding: 0.55rem; }
	.section { margin-top: 2rem; }
	.tx { display: flex; gap: 0.6rem; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid var(--pp-border); }
	.tx:last-child { border-bottom: 0; }
	.grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
</style>
