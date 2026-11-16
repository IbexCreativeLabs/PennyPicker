<script lang="ts">
	import { onMount } from 'svelte';
	import { Connection, TestNetWallet } from '@unspent/wallet';
	import type { Utxo } from '@unspent/wallet';

	const address = 'bchtest:qq3gfs2492tlz2nckgpq6wn28fcd80lucvlxe0nrf0';
	let utxos = $state<Utxo[]>([]);
	let bchOnlyUtxos = $state<Utxo[]>([]);
	let totalAllSatoshis = $state(0n);
	let totalBchOnlySatoshis = $state(0n);
	let tokenBearingCount = $state(0);
	let loading = $state(true);
	let error = $state('');

	const formatBch = (satoshis: bigint) => {
		const whole = satoshis / 100_000_000n;
		const fraction = (satoshis % 100_000_000n).toString().padStart(8, '0');
		return `${whole}.${fraction}`;
	};

	onMount(async () => {
		try {
			const wallet = await TestNetWallet.watchOnly(address);
			const connection = new Connection('testnet', 'wss://chipnet.bch.ninja:50004');
			wallet.provider = connection.networkProvider;

			utxos = await wallet.getUtxos();
			bchOnlyUtxos = utxos.filter((utxo) => !utxo.token);
			totalAllSatoshis = utxos.reduce((sum, utxo) => sum + utxo.satoshis, 0n);
			totalBchOnlySatoshis = bchOnlyUtxos.reduce(
				(sum, utxo) => sum + utxo.satoshis,
				0n
			);
			tokenBearingCount = utxos.filter((utxo) => Boolean(utxo.token)).length;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			loading = false;
		}
	});

	const voutZero = $derived(bchOnlyUtxos.filter((utxo) => utxo.vout === 0));
</script>

<svelte:head>
	<title>Chipnet Watch Only Diagnostic</title>
</svelte:head>

<h1>Chipnet watch only UTXO diagnostic</h1>
<p><strong>Inspected public address:</strong> <code>{address}</code></p>

{#if loading}
	<p>Retrieving UTXOs from the configured Chipnet Electrum provider…</p>
{:else if error}
	<p role="alert">Could not retrieve UTXOs: {error}</p>
{:else}
	<h2>All returned UTXOs ({utxos.length})</h2>
	{#if utxos.length === 0}
		<p>No UTXOs were returned.</p>
	{:else}
		<ul>
			{#each utxos as utxo (`${utxo.txid}:${utxo.vout}`)}
				<li>
					<code>{utxo.txid}</code> — vout {utxo.vout} — {utxo.satoshis.toString()} satoshis —
					Token present: {utxo.token ? 'YES' : 'NO'}
				</li>
			{/each}
		</ul>
	{/if}

	<p><strong>Total satoshis across all UTXOs:</strong> {totalAllSatoshis.toString()}</p>
	<p><strong>Total satoshis across BCH only UTXOs:</strong> {totalBchOnlySatoshis.toString()} ({formatBch(totalBchOnlySatoshis)} BCH)</p>
	<p><strong>Token-bearing UTXOs:</strong> {tokenBearingCount}</p>
	<h2>BCH only UTXOs with vout === 0</h2>
	{#if voutZero.length === 0}
		<p>None.</p>
	{:else}
		<ul>
			{#each voutZero as utxo (`${utxo.txid}:${utxo.vout}`)}
				<li><code>{utxo.txid}</code> — vout {utxo.vout} — {utxo.satoshis.toString()} satoshis</li>
			{/each}
		</ul>
	{/if}
	<p><strong>Genesis eligible UTXO exists:</strong> {voutZero.length > 0 ? 'YES' : 'NO'}</p>
{/if}

<p>This page uses a watch only wallet and performs no signing or transaction submission.</p>
