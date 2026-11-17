<script lang="ts">
	import { pp } from './session.svelte';
	import TxFlow from './TxFlow.svelte';
	import { buildPusdGenesis, type UnsignedExchangeTransaction } from '$lib/pennypicker/exchange';
	import { writeStorage } from '$lib/pennypicker/chain';
	import { PUSD_CATEGORY_STORAGE_KEY, PUSD_INITIAL_AMOUNT } from '$lib/pennypicker/pusdGenesis';
	import { errorText } from './wallet';

	let pending = $state<UnsignedExchangeTransaction | undefined>();
	let error = $state('');
	let busy = $state(false);

	async function review() {
		error = '';
		busy = true;
		try {
			if (!pp.wallet) throw new Error('Connect Cashonize first.');
			await pp.refreshWallet();
			pending = buildPusdGenesis(pp.wallet.address, pp.utxos, PUSD_INITIAL_AMOUNT);
		} catch (cause) {
			error = errorText(cause);
		} finally {
			busy = false;
		}
	}

	function onBroadcast(txid: string, unsigned: UnsignedExchangeTransaction) {
		// Use the new category in this browser right away; the shared default lives in deployment.ts.
		if (unsigned.createdCategory) writeStorage(PUSD_CATEGORY_STORAGE_KEY, unsigned.createdCategory);
		pp.recordBroadcast(txid, unsigned);
		pp.reloadConfig();
	}
</script>

{#if pending && pp.wallet}
	<TxFlow unsigned={pending} wallet={pp.wallet} title="Create PUSD" {onBroadcast} onDismiss={() => (pending = undefined)} />
{:else}
	<p class="small muted">
		Output 0 keeps the token identity as a BCH-only coin; output 1 holds the whole supply. Ordinary sends and trades never touch output 0.
	</p>
	<button class="pp-btn pp-btn-primary" type="button" onclick={review} disabled={busy || !pp.wallet}>
		{busy ? 'Checking Chipnet…' : pp.wallet ? 'Review PUSD genesis' : 'Connect a wallet to create PUSD'}
	</button>
{/if}
{#if error}<p class="pp-error">{error}</p>{/if}
