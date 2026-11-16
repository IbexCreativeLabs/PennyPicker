<script lang="ts">
	import { stringify } from '@bitauth/libauth';
	import { requestCashonizeTransactionSignature, describeWalletConnectError } from '$lib/cashonize/walletconnect';
	import { verifySignedMatchesUnsigned, type UnsignedExchangeTransaction } from '$lib/pennypicker/exchange';
	import { broadcastSignedTransaction } from '$lib/pennypicker/chain';
	import type { ConnectedWallet } from './wallet';

	interface Props {
		unsigned: UnsignedExchangeTransaction;
		wallet: ConnectedWallet;
		onBroadcast: (txid: string, unsigned: UnsignedExchangeTransaction) => void;
		onDismiss: () => void;
	}
	let { unsigned, wallet, onBroadcast, onDismiss }: Props = $props();

	let stage = $state<'preview' | 'signing' | 'signed' | 'broadcasting' | 'done'>('preview');
	let signedHex = $state('');
	let txid = $state('');
	let error = $state('');
	let showHex = $state(false);

	async function sign() {
		stage = 'signing';
		error = '';
		try {
			const result = await requestCashonizeTransactionSignature(
				wallet.client,
				wallet.session,
				unsigned.unsignedHex,
				JSON.parse(stringify(unsigned.sourceOutputs)),
				`PennyPicker: ${unsigned.summary[0] ?? unsigned.kind}`
			);
			txid = verifySignedMatchesUnsigned(unsigned, result.signedTransaction, result.signedTransactionHash);
			signedHex = result.signedTransaction;
			stage = 'signed';
		} catch (cause) {
			error = describeWalletConnectError(cause);
			stage = 'preview';
		}
	}

	async function broadcast() {
		stage = 'broadcasting';
		error = '';
		try {
			const accepted = await broadcastSignedTransaction(wallet.address, signedHex);
			if (accepted !== txid) throw new Error('The Chipnet provider returned a different transaction id.');
			stage = 'done';
			onBroadcast(txid, unsigned);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			stage = 'signed';
		}
	}
</script>

<section class="txflow">
	<h3>Review transaction — {unsigned.kind}</h3>
	<ul>
		{#each unsigned.summary as line}<li>{line}</li>{/each}
	</ul>
	<p class="meta">
		{unsigned.transaction.inputs.length} inputs · {unsigned.transaction.outputs.length} outputs ·
		{unsigned.unsignedHex.length / 2} unsigned bytes ·
		<button class="link" type="button" onclick={() => (showHex = !showHex)}>{showHex ? 'hide' : 'show'} hex</button>
	</p>
	{#if showHex}<pre>{unsigned.unsignedHex}</pre>{/if}
	<ol class="steps">
		<li class:active={stage === 'preview' || stage === 'signing'}>Unsigned preview built</li>
		<li class:active={stage === 'signed' || stage === 'broadcasting'}>Signed by Cashonize, checked against preview</li>
		<li class:active={stage === 'done'}>Broadcast to Chipnet</li>
	</ol>
	{#if stage === 'preview' || stage === 'signing'}
		<button type="button" onclick={sign} disabled={stage === 'signing'}>
			{stage === 'signing' ? 'Waiting for Cashonize…' : 'Request Cashonize signature (no broadcast)'}
		</button>
		<button type="button" class="secondary" onclick={onDismiss} disabled={stage === 'signing'}>Discard</button>
	{:else if stage === 'signed' || stage === 'broadcasting'}
		<p>Signed transaction <code>{txid}</code> matches the preview. It has <strong>not</strong> been broadcast.</p>
		<button type="button" class="danger" onclick={broadcast} disabled={stage === 'broadcasting'}>
			{stage === 'broadcasting' ? 'Broadcasting…' : 'Broadcast to Chipnet'}
		</button>
		<button type="button" class="secondary" onclick={onDismiss} disabled={stage === 'broadcasting'}>Discard signed transaction</button>
	{:else}
		<p>Broadcast accepted: <code>{txid}</code>. Confirmation is pending.</p>
		<button type="button" class="secondary" onclick={onDismiss}>Close</button>
	{/if}
	{#if error}<p class="error">{error}</p>{/if}
</section>

<style>
	.txflow { border: 2px solid #c08a1e; border-radius: 0.5rem; padding: 1rem; margin: 1rem 0; background: #fffaf0; }
	.meta { font-size: 0.85rem; color: #555; }
	pre { white-space: pre-wrap; word-break: break-all; font-size: 0.7rem; max-height: 10rem; overflow: auto; }
	.steps li { color: #888; }
	.steps li.active { color: #000; font-weight: 600; }
	button { margin: 0.25rem 0.5rem 0.25rem 0; padding: 0.4rem 0.8rem; }
	.danger { background: #8a291f; color: white; border: 0; border-radius: 0.3rem; }
	.secondary { background: transparent; }
	.link { border: 0; background: none; color: #1a5fb4; text-decoration: underline; padding: 0; margin: 0; cursor: pointer; }
	.error { color: #a00; }
	code { word-break: break-all; }
</style>
