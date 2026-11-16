<script lang="ts">
	import { pp, explorerTx } from '$lib/pennypicker/ui/session.svelte';
	import { CHIPNET_CHAIN } from '$lib/cashonize/walletconnect';
	import { formatSats, formatUnits } from '$lib/pennypicker/exchange';

	const sorted = $derived(
		[...pp.utxos].sort((a, b) => Number(!!a.token) - Number(!!b.token) || (a.satoshis > b.satoshis ? -1 : 1))
	);
	const label = (category: string) =>
		category === pp.config.pusdCategory ? 'PUSD' : category === pp.config.oracleCategory ? 'Oracle' : `${category.slice(0, 8)}…`;
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
									{#if utxo.vout === 0 && !utxo.token && (utxo.height ?? 0) > 0}<span class="pp-badge plain accent" title="Can be spent as a CashToken genesis input">genesis-ready</span>{/if}
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
	.pairing { margin-top: 1rem; display: grid; gap: 0.6rem; justify-items: start; }
	qr-code { width: 15rem; max-width: 100%; background: #fff; border-radius: 8px; padding: 0.4rem; }
	textarea { font-family: var(--pp-mono); font-size: 0.75rem; }
	.bal { gap: 0.5rem; }
</style>
