<script lang="ts">
	import { pp, explorerTx } from '$lib/pennypicker/ui/session.svelte';
	import { CHIPNET_CHAIN } from '$lib/cashonize/walletconnect';
	import {
		buildPusdTransfer,
		formatSats,
		formatUnits,
		lockingBytecodeToChipnetAddress,
		p2pkhLockingBytecode,
		type UnsignedExchangeTransaction
	} from '$lib/pennypicker/exchange';
	import TxFlow from '$lib/pennypicker/ui/TxFlow.svelte';
	import { errorText, parsePusd } from '$lib/pennypicker/ui/wallet';

	const tokenAddress = $derived(pp.wallet ? lockingBytecodeToChipnetAddress(p2pkhLockingBytecode(pp.wallet.pkh), true) : '');
	let copied = $state(false);
	async function copyAddress() {
		try {
			await navigator.clipboard.writeText(tokenAddress);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			copied = false;
		}
	}

	// ---- Send PUSD (seed teammates' test wallets)
	let recipientsText = $state('');
	let sendError = $state('');
	let pending = $state<UnsignedExchangeTransaction | undefined>();
	/** Before oracle genesis, the operator's confirmed vout-0 UTXO is kept for it. */
	const reserved = $derived(
		pp.isOperator && !pp.oracle && pp.genesisReadyUtxo ? [`${pp.genesisReadyUtxo.txid}:${pp.genesisReadyUtxo.vout}`] : []
	);
	const parsedRecipients = $derived.by(() => {
		const lines = recipientsText.split('\n').map((line) => line.trim()).filter(Boolean);
		try {
			return {
				list: lines.map((line, i) => {
					const [address, amount, ...rest] = line.split(/[\s,;]+/);
					if (!address || !amount || rest.length > 0) throw new Error(`Line ${i + 1}: use "address amount".`);
					return { address, units: parsePusd(amount) };
				})
			};
		} catch (cause) {
			return { list: [], error: errorText(cause) };
		}
	});
	const sendTotal = $derived(parsedRecipients.list.reduce((sum, r) => sum + r.units, 0n));

	async function prepareSend() {
		sendError = '';
		try {
			if (!pp.wallet) throw new Error('Connect Cashonize first.');
			if (!pp.config.pusdCategory) throw new Error('PUSD category is not configured.');
			if (parsedRecipients.error) throw new Error(parsedRecipients.error);
			await pp.refreshWallet();
			pending = buildPusdTransfer(pp.config.pusdCategory, pp.wallet.address, pp.utxos, parsedRecipients.list, reserved);
		} catch (cause) {
			sendError = errorText(cause);
		}
	}

	const sorted = $derived(
		[...pp.utxos].sort((a, b) => Number(!!a.token) - Number(!!b.token) || (a.satoshis > b.satoshis ? -1 : 1))
	);
	const label = (category: string) =>
		category === pp.config.pusdCategory ? 'PUSD' : category === pp.config.oracleCategory ? 'Oracle' : `${category.slice(0, 8)}…`;

	let uriCopied = $state(false);
	async function copyPairingUri() {
		try {
			await navigator.clipboard.writeText(pp.pairingUri ?? '');
			uriCopied = true;
			setTimeout(() => (uriCopied = false), 2500);
		} catch {
			uriCopied = false;
		}
	}
</script>

<svelte:head><title>Wallet · PennyPicker</title></svelte:head>

<main class="pp-container">
	<div class="pp-page-head">
		<div>
			<h1>Wallet</h1>
			<p>PennyPicker connects to Cashonize through WalletConnect. Your keys stay in Cashonize: the app only reads your public address and asks Cashonize to sign transactions you review.</p>
		</div>
	</div>

	<div class="pp-grid-2">
		<section class="pp-card">
			<div class="pp-card-head">
				<h2>Connection</h2>
				<span class="pp-badge {pp.walletStatus === 'connected' ? 'ok' : pp.walletStatus === 'connecting' || pp.walletStatus === 'checking' ? 'warn' : 'bad'}">{pp.walletStatus}</span>
			</div>
			<dl class="pp-kv">
				<dt>Wallet</dt><dd>Cashonize (WalletConnect v2)</dd>
				<dt>Network</dt><dd>BCH Chipnet <span class="faint mono">{CHIPNET_CHAIN}</span></dd>
				{#if pp.wallet}
					<dt>Address</dt><dd class="mono">{pp.wallet.address}</dd>
					<dt>Token address</dt>
					<dd><span class="mono">{tokenAddress}</span> <button class="pp-btn pp-btn-ghost pp-btn-sm" type="button" onclick={copyAddress}>{copied ? 'Copied' : 'Copy'}</button><br /><span class="small muted">Share this to receive PUSD from a teammate.</span></dd>
					<dt>Key hash</dt><dd class="mono">{pp.wallet.pkh}</dd>
					<dt>Role</dt><dd>{pp.isOperator ? 'Oracle operator · trader' : 'Trader'}</dd>
				{/if}
			</dl>
			<div class="pp-row" style="margin-top: 0.85rem">
				{#if pp.wallet}
					<button class="pp-btn" type="button" onclick={() => pp.refreshWallet()} disabled={pp.loadingWallet}>{pp.loadingWallet ? 'Refreshing…' : 'Refresh balances'}</button>
					<button class="pp-btn pp-btn-ghost" type="button" onclick={() => pp.disconnect()}>Disconnect</button>
				{:else}
					<button class="pp-btn pp-btn-primary" type="button" onclick={() => pp.connect()} disabled={pp.walletStatus === 'connecting' || pp.walletStatus === 'checking'}>
						{pp.walletStatus === 'connecting' ? 'Waiting for Cashonize…' : 'Connect Cashonize'}
					</button>
				{/if}
			</div>
			{#if pp.pairingUri}
				<div class="pairing">
					<p class="small">Scan with Cashonize (set to Chipnet), or paste the URI into Cashonize's WalletConnect screen.</p>
					<qr-code contents={pp.pairingUri} aria-label="WalletConnect pairing QR code"></qr-code>
					<div class="pair-copy">
						<button class="pp-btn pp-btn-sm" type="button" onclick={copyPairingUri}>{uriCopied ? 'Copied ✓' : 'Copy pairing URI'}</button>
						<a class="pp-btn pp-btn-sm" href={`https://cashonize.com/?uri=${encodeURIComponent(pp.pairingUri ?? '')}`} target="_blank" rel="noopener">Open in Cashonize web ↗</a>
						<span class="small muted">or paste the URI in Cashonize → Connect.</span>
					</div>
					<details class="pp-details"><summary>Pairing URI</summary><textarea class="pp-input" readonly rows="4">{pp.pairingUri}</textarea></details>
				</div>
			{/if}
			{#if pp.walletError}<p class="pp-error">{pp.walletError}</p>{/if}
		</section>

		<section class="pp-card">
			<h2>Balances</h2>
			{#if pp.wallet && pp.utxosLoaded}
				<div class="pp-grid-2 bal">
					<div>
						<div class="pp-stat-label">BCH</div>
						<div class="pp-stat-value">{formatSats(pp.balances.bchSats)}</div>
						<div class="small muted">{formatSats(pp.balances.bchSats - pp.balances.bchConfirmedSats)} pending · {pp.balances.bchUtxoCount} UTXO(s)</div>
					</div>
					<div>
						<div class="pp-stat-label">PUSD</div>
						<div class="pp-stat-value">{formatUnits(pp.balances.pusdUnits)}</div>
						<div class="small muted">{formatUnits(pp.balances.pusdUnits - pp.balances.pusdConfirmedUnits)} pending</div>
					</div>
				</div>
				<p class="small muted" style="margin-top: 0.6rem">
					{pp.balances.tokenUtxoCount} token UTXO(s) also carry {formatSats(pp.balances.tokenUtxoSats)} BCH. That BCH is not counted above because it travels with the tokens.
				</p>
			{:else if pp.wallet}
				<p class="muted">Loading…</p>
			{:else}
				<p class="muted">Connect to see balances.</p>
			{/if}
		</section>
	</div>

	{#if pp.wallet && pp.utxosLoaded}
		<section class="pp-card" style="margin-top: 1rem">
			<div class="pp-card-head">
				<h2>Send PUSD <span class="pp-badge ok plain">On-chain</span></h2>
				<span class="small muted">Seed teammates' test wallets</span>
			</div>
			{#if pending}
				<TxFlow unsigned={pending} wallet={pp.wallet} onBroadcast={(txid, u) => { pp.recordBroadcast(txid, u); recipientsText = ''; }} onDismiss={() => (pending = undefined)} />
			{:else if pp.ownIdentityUtxo?.token}
				<p class="pp-callout warn small">Your PUSD sits on the PUSD identity coin, so sending it would move the token identity. Separate them first: <a href="/penny-picker/token">Token → PUSD identity</a>.</p>
			{:else if pp.balances.pusdUnits === 0n}
				<p class="muted small">This wallet holds no PUSD. Ask the operator to send some to your token address above, or sell BCH into a bid on the Exchange.</p>
			{:else}
				<p class="small muted">One recipient per line: <span class="mono">address amount</span>, e.g. <span class="mono">bchtest:z… 250.00</span>. Chipnet addresses only. Each recipient also receives 1,000 sats that travel with the tokens. PUSD is a test token with no value.</p>
				<textarea class="pp-input mono" rows="4" placeholder="bchtest:z… 250.00" bind:value={recipientsText}></textarea>
				<div class="pp-row" style="margin-top: 0.6rem">
					<button class="pp-btn pp-btn-primary" type="button" onclick={prepareSend} disabled={parsedRecipients.list.length === 0}>Review transfer</button>
					<span class="small muted">
						{#if parsedRecipients.error}<span class="pp-error-inline">{parsedRecipients.error}</span>
						{:else if parsedRecipients.list.length}{parsedRecipients.list.length} recipient(s) · {formatUnits(sendTotal)} of {formatUnits(pp.balances.pusdUnits)} PUSD{/if}
					</span>
				</div>
				{#if reserved.length}<p class="pp-callout warn small" style="margin-top: 0.6rem">The oracle does not exist yet, so your confirmed vout-0 UTXO is kept for oracle genesis and won't be spent here.</p>{/if}
				{#if sendError}<p class="pp-error">{sendError}</p>{/if}
			{/if}
		</section>

		<section class="pp-card" style="margin-top: 1rem">
			<h2>Unspent outputs</h2>
			<div class="pp-table-wrap">
				<table class="pp-table">
					<thead><tr><th>Outpoint</th><th class="r">BCH</th><th>Token</th><th>Status</th></tr></thead>
					<tbody>
						{#each sorted as utxo (utxo.txid + utxo.vout)}
							<tr>
								<td class="mono small"><a href={explorerTx(utxo.txid)} target="_blank" rel="noopener">{utxo.txid.slice(0, 12)}…:{utxo.vout}</a></td>
								<td class="r">{formatSats(utxo.satoshis)}</td>
								<td>
									{#if utxo.token}
										<span class="pp-badge plain accent">{label(utxo.token.category)}</span>
										{utxo.token.category === pp.config.pusdCategory ? formatUnits(utxo.token.amount) : utxo.token.amount.toString()}
										{utxo.token.nft ? ` · ${utxo.token.nft.capability} NFT` : ''}
									{:else}
										<span class="muted">BCH only</span>
									{/if}
								</td>
								<td>
									<span class="pp-badge {(utxo.height ?? 0) > 0 ? 'ok' : 'warn'}">{(utxo.height ?? 0) > 0 ? 'confirmed' : 'pending'}</span>
									{#if utxo.identityOf}<span class="pp-badge warn plain" title="Token identity output. PennyPicker never spends it in ordinary transactions.">{utxo.identityOf === pp.config.pusdCategory && pp.pusdIdentity ? 'PUSD identity' : 'held back'}</span>{/if}
									{#if utxo.vout === 0 && !utxo.token && !utxo.identityOf && (utxo.height ?? 0) > 0}<span class="pp-badge plain accent" title="Can be spent as a CashToken genesis input">genesis-ready</span>{/if}
								</td>
							</tr>
						{:else}
							<tr><td colspan="4" class="muted small">No UTXOs. Fund this address from a Chipnet faucet.</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</main>

<style>
	.pair-copy { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin: 0.5rem 0; }
	.pairing { margin-top: 1rem; display: grid; gap: 0.6rem; justify-items: start; }
	qr-code { width: 15rem; max-width: 100%; background: #fff; border-radius: 8px; padding: 0.4rem; }
	textarea { font-family: var(--pp-mono); font-size: 0.75rem; }
	.bal { gap: 0.5rem; }
	.pp-error-inline { color: var(--pp-danger); }
	textarea.mono { width: 100%; }
</style>
