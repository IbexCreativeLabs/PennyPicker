<script lang="ts">
	import { onMount } from 'svelte';
	import TxFlow from '$lib/pennypicker/ui/TxFlow.svelte';
	import { connectCashonize, errorText, formatPusdPerBch, rateFromPusdPerBch, type ConnectedWallet } from '$lib/pennypicker/ui/wallet';
	import {
		getAddressUtxos,
		getOracleState,
		loadMarketConfig,
		oracleAddress,
		ORACLE_CATEGORY_STORAGE_KEY,
		ORACLE_OPERATOR_STORAGE_KEY,
		writeStorage
	} from '$lib/pennypicker/chain';
	import { buildOracleGenesis, buildOracleUpdate, type OracleUtxo, type UnsignedExchangeTransaction } from '$lib/pennypicker/exchange';

	let wallet = $state<ConnectedWallet | undefined>();
	let config = $state(loadMarketConfig());
	let oracle = $state<OracleUtxo | undefined>();
	let priceInput = $state('');
	let pending = $state<UnsignedExchangeTransaction | undefined>();
	let error = $state('');
	let info = $state('');
	let busy = $state(false);

	const isOperator = $derived(!!wallet && (!config.oracleOperatorPkh || config.oracleOperatorPkh === wallet.pkh));

	onMount(() => {
		config = loadMarketConfig();
		if (config.oracleCategory && config.oracleOperatorPkh) void refresh();
	});

	async function connect() {
		error = '';
		try {
			wallet = await connectCashonize();
		} catch (cause) {
			error = errorText(cause);
		}
	}

	async function refresh() {
		config = loadMarketConfig();
		if (!config.oracleCategory || !config.oracleOperatorPkh) return;
		try {
			oracle = await getOracleState({ pusdCategory: config.pusdCategory ?? '00'.repeat(32), oracleCategory: config.oracleCategory, oracleOperatorPkh: config.oracleOperatorPkh });
			if (!oracle) info = 'No oracle-state UTXO found yet (genesis may be unconfirmed or not broadcast).';
		} catch (cause) {
			error = errorText(cause);
		}
	}

	async function prepareGenesis() {
		if (!wallet) return;
		busy = true;
		error = '';
		try {
			const rate = rateFromPusdPerBch(priceInput);
			const utxos = await getAddressUtxos(wallet.address);
			pending = buildOracleGenesis(wallet.address, wallet.pkh, utxos, {
				rateSatsPerPusdScaled: rate,
				timestamp: Math.floor(Date.now() / 1000),
				sequence: 1
			});
		} catch (cause) {
			error = errorText(cause);
		} finally {
			busy = false;
		}
	}

	async function prepareUpdate() {
		if (!wallet || !oracle || !config.oracleCategory || !config.oracleOperatorPkh) return;
		busy = true;
		error = '';
		try {
			await refresh();
			if (!oracle) throw new Error('Oracle state not found.');
			const rate = rateFromPusdPerBch(priceInput);
			const utxos = await getAddressUtxos(wallet.address);
			pending = buildOracleUpdate(
				{ pusdCategory: config.pusdCategory ?? '00'.repeat(32), oracleCategory: config.oracleCategory, oracleOperatorPkh: config.oracleOperatorPkh },
				oracle,
				wallet.address,
				utxos,
				{ rateSatsPerPusdScaled: rate, timestamp: Math.max(Math.floor(Date.now() / 1000), oracle.state.timestamp), sequence: oracle.state.sequence + 1 }
			);
		} catch (cause) {
			error = errorText(cause);
		} finally {
			busy = false;
		}
	}

	function broadcasted(txid: string, unsigned: UnsignedExchangeTransaction) {
		if (unsigned.kind === 'oracle-genesis' && unsigned.createdCategory && wallet) {
			writeStorage(ORACLE_CATEGORY_STORAGE_KEY, unsigned.createdCategory);
			writeStorage(ORACLE_OPERATOR_STORAGE_KEY, wallet.pkh);
			info = `Oracle created (category ${unsigned.createdCategory}). Saved to this browser. Share it via VITE_PENNYPICKER_ORACLE_CATEGORY / VITE_PENNYPICKER_ORACLE_OPERATOR_PKH.`;
		} else {
			info = `Price update broadcast: ${txid}`;
		}
		setTimeout(refresh, 2000);
	}
</script>

<svelte:head><title>PennyPicker oracle operator</title></svelte:head>

<main>
	<p><a href="/penny-picker/exchange">← Exchange</a></p>
	<h1>BCH/PUSD reference oracle (operator)</h1>
	<p class="notice">
		This oracle is an <strong>operator-attested reference</strong> for the experimental Chipnet PUSD token. It is not a
		market feed and PUSD is not USD. Whoever controls the operator key decides the reference price that every
		PennyPicker order is priced against. The covenant guarantees only the <em>latest</em> published price can be used by
		fills; it cannot enforce how recent that publication is.
	</p>

	{#if !wallet}
		<button type="button" onclick={connect}>Use connected Cashonize wallet</button>
		<p class="hint">No session? Connect on <a href="/cashonize">/cashonize</a> first.</p>
	{:else}
		<p>Wallet: <code>{wallet.address}</code> (PKH <code>{wallet.pkh}</code>)</p>
	{/if}

	<section>
		<h2>Status</h2>
		<dl>
			<dt>Oracle category</dt><dd><code>{config.oracleCategory ?? 'not created'}</code> <small>({config.source.oracleCategory})</small></dd>
			<dt>Operator PKH</dt><dd><code>{config.oracleOperatorPkh ?? '—'}</code></dd>
			{#if config.oracleOperatorPkh}<dt>Oracle contract</dt><dd><code>{oracleAddress(config.oracleOperatorPkh)}</code></dd>{/if}
			{#if oracle}
				<dt>Reference</dt><dd><strong>{formatPusdPerBch(oracle.state.rateSatsPerPusdScaled)} PUSD per BCH</strong></dd>
				<dt>Sequence</dt><dd>{oracle.state.sequence}</dd>
				<dt>Operator timestamp</dt><dd>{new Date(oracle.state.timestamp * 1000).toISOString()}</dd>
				<dt>UTXO</dt><dd><code>{oracle.txid}:{oracle.vout}</code> {(oracle.height ?? 0) > 0 ? 'confirmed' : 'unconfirmed'}</dd>
			{/if}
		</dl>
		<button type="button" onclick={refresh}>Refresh</button>
	</section>

	{#if wallet}
		<section>
			<h2>{config.oracleCategory ? 'Publish new reference price' : 'Create oracle'}</h2>
			{#if !isOperator}
				<p class="error">The connected wallet is not this oracle's operator.</p>
			{:else}
				<label>Reference price (PUSD per BCH) <input bind:value={priceInput} placeholder="e.g. 500.00" /></label>
				{#if config.oracleCategory}
					<button type="button" onclick={prepareUpdate} disabled={busy || !oracle}>Prepare update</button>
				{:else}
					<p class="hint">Genesis spends a BCH-only UTXO at output index 0 from your wallet (create one with the self-transfer on <a href="/penny-picker/token">/penny-picker/token</a>). It mints a single mutable NFT into the oracle contract; no minting baton.</p>
					<button type="button" onclick={prepareGenesis} disabled={busy}>Prepare oracle genesis</button>
				{/if}
			{/if}
		</section>
	{/if}

	{#if pending && wallet}
		<TxFlow unsigned={pending} {wallet} onBroadcast={broadcasted} onDismiss={() => (pending = undefined)} />
	{/if}
	{#if info}<p class="info">{info}</p>{/if}
	{#if error}<p class="error">{error}</p>{/if}
</main>

<style>
	main { max-width: 52rem; margin: 0 auto; padding: 1rem; }
	.notice { background: #fff4d6; border-left: 4px solid #c08a1e; padding: 0.75rem; }
	dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; }
	dd { margin: 0; word-break: break-all; }
	.error { color: #a00; }
	.info { color: #145a32; word-break: break-all; }
	.hint { font-size: 0.85rem; color: #555; }
	input { margin: 0 0.5rem; }
	section { margin: 1.25rem 0; }
</style>
