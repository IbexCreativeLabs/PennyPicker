<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { binToHex, hashTransaction, hexToBin, stringify } from '@bitauth/libauth';
	import { requestCashonizeTransactionSignature } from '$lib/cashonize/walletconnect';
	import { lockingBytecodeToAddress, verifySignedMatchesUnsigned, type UnsignedExchangeTransaction } from '$lib/pennypicker/exchange';
	import { assertBroadcastAllowed, broadcastSignedTransaction, transactionHeight } from '$lib/pennypicker/chain';
	import { NETWORKS } from '$lib/pennypicker/network';
	import { formatBchFromSatoshis } from '$lib/pennypicker/market';
	import { explorerTx, pp } from './session.svelte';
	import { describeBroadcastError, describeSignError } from './txErrors';
	import type { ConnectedWallet } from './wallet';

	interface Props {
		unsigned: UnsignedExchangeTransaction;
		wallet: ConnectedWallet;
		title?: string;
		onBroadcast: (txid: string, unsigned: UnsignedExchangeTransaction) => void;
		onDismiss: () => void;
		/** Rebuild from fresh chain state after a conflict (e.g. someone else spent the oracle first). */
		onRebuild?: () => void;
	}
	let { unsigned, wallet, title, onBroadcast, onDismiss, onRebuild }: Props = $props();
	/** The broadcast lost a race for a shared input: the transaction must be rebuilt, not retried. */
	let conflict = $state(false);
	const net = $derived(NETWORKS[wallet.network]);
	const walletLabel = $derived(wallet.kind === 'wizardconnect' ? wallet.signer.walletName : 'Cashonize');

	type Stage = 'preview' | 'signing' | 'signed' | 'broadcasting' | 'broadcast' | 'confirmed';
	let stage = $state<Stage>('preview');
	let signedHex = $state('');
	let txid = $state('');
	let error = $state('');
	let confirmations = $state(0);
	let poll: ReturnType<typeof setInterval> | undefined;
	let panel = $state<HTMLElement | undefined>();
	// Shown as a modal: lock page scroll, focus the dialog, and pause background market refreshes while it is open.
	let previousOverflow = '';
	onMount(() => {
		previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		pp.txOpen += 1;
		panel?.focus();
	});
	onDestroy(() => {
		document.body.style.overflow = previousOverflow;
		pp.txOpen = Math.max(0, pp.txOpen - 1);
	});
	/** Escape closes the dialog, except while the wallet is signing or the broadcast is in flight. */
	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape' && stage !== 'signing' && stage !== 'broadcasting') onDismiss();
	}

	const kindLabel: Record<UnsignedExchangeTransaction['kind'], string> = {
		'oracle-genesis': 'Create oracle',
		'oracle-update': 'Publish reference price',
		'order-create': 'Place order',
		'order-fill': 'Fill orders',
		'order-cancel': 'Cancel order',
		'pusd-send': 'Send tokens',
		'identity-separation': 'Separate token identity',
		'pusd-genesis': 'Create token',
		'bcmr-publication': 'Publish token metadata'
	};

	const rows = $derived(
		unsigned.transaction.outputs.map((output, index) => {
			let to = 'OP_RETURN (order announcement)';
			if (output.lockingBytecode[0] !== 0x6a) {
				try {
					to = lockingBytecodeToAddress(output.lockingBytecode, wallet.network, !!output.token);
				} catch {
					to = binToHex(output.lockingBytecode);
				}
			}
			const mine = output.lockingBytecode.length === 25 && binToHex(output.lockingBytecode).includes(wallet.pkh);
			return { index, to, mine, sats: output.valueSatoshis, token: output.token };
		})
	);
	const inputs = $derived(
		unsigned.sourceOutputs.map((source, index) => ({
			index,
			outpoint: `${binToHex(source.outpointTransactionHash)}:${source.outpointIndex}`,
			sats: source.valueSatoshis,
			contract: source.contract ? `${source.contract.artifact.contractName}.${source.contract.abiFunction.name}()` : 'Your wallet',
			token: source.token
		}))
	);

	const steps: { key: Stage[]; label: string }[] = [
		{ key: ['preview', 'signing'], label: 'Review' },
		{ key: ['signed', 'broadcasting'], label: 'Signed' },
		{ key: ['broadcast'], label: 'Broadcast' },
		{ key: ['confirmed'], label: 'Confirmed' }
	];
	const order: Stage[] = ['preview', 'signing', 'signed', 'broadcasting', 'broadcast', 'confirmed'];
	const stepIndex = $derived(steps.findIndex((s) => s.key.includes(stage)));

	let slow = $state(false);
	let slowTimer: ReturnType<typeof setTimeout> | undefined;

	async function sign() {
		stage = 'signing';
		error = '';
		slowTimer = setTimeout(() => (slow = true), 45_000);
		try {
			// Do not even ask the wallet to sign what this build may not broadcast.
			assertBroadcastAllowed(wallet.network);
			const prompt = `PennyPicker: ${unsigned.summary[0] ?? unsigned.kind}`;
			let result: { signedTransaction: string; signedTransactionHash: string };
			if (wallet.kind === 'wizardconnect') {
				// WizardConnect returns only the signed bytes; the content checks below still compare every input and output.
				const signedTransaction = await wallet.signer.sign(unsigned.unsignedHex, unsigned.sourceOutputs, prompt);
				result = { signedTransaction, signedTransactionHash: hashTransaction(hexToBin(signedTransaction)) };
			} else {
				result = await requestCashonizeTransactionSignature(
					wallet.client,
					wallet.session,
					unsigned.unsignedHex,
					JSON.parse(stringify(unsigned.sourceOutputs)),
					prompt,
					net.walletConnectChain
				);
			}
			txid = verifySignedMatchesUnsigned(unsigned, result.signedTransaction, result.signedTransactionHash);
			signedHex = result.signedTransaction;
			stage = 'signed';
		} catch (cause) {
			error = describeSignError(cause, net.label);
			stage = 'preview';
		} finally {
			clearTimeout(slowTimer);
			slow = false;
		}
	}

	async function broadcast() {
		stage = 'broadcasting';
		error = '';
		try {
			const accepted = await broadcastSignedTransaction(wallet.address, signedHex);
			if (accepted !== txid) throw new Error(`The ${net.label} server returned a different transaction id.`);
			stage = 'broadcast';
			onBroadcast(txid, unsigned);
			poll = setInterval(checkConfirmation, 20_000);
		} catch (cause) {
			const explained = describeBroadcastError(cause, net.label);
			if (explained.startsWith(`${net.label} already has`)) {
				stage = 'broadcast';
				onBroadcast(txid, unsigned);
				poll = setInterval(checkConfirmation, 20_000);
				return;
			}
			error = explained;
			conflict = explained.startsWith('An input was already spent');
			stage = 'signed';
		}
	}

	/** Consecutive polls in which the server did not know the transaction. */
	let misses = 0;
	async function checkConfirmation() {
		let height: number | undefined;
		try {
			height = await transactionHeight(wallet.address, txid);
		} catch {
			return; // transient network error: the next poll retries
		}
		if (height === undefined) {
			// Unknown three times in a row (about a minute): a competing transaction won.
			if (++misses >= 3) {
				clearInterval(poll);
				error = `${net.label} no longer has this transaction, usually because a competing one spent the same order or oracle first. Nothing changed in your wallet. Rebuild it against the latest state and sign again.`;
				conflict = true;
			}
			return;
		}
		misses = 0;
		if (height && height > 0) {
			confirmations = height;
			stage = 'confirmed';
			clearInterval(poll);
		}
	}

	onDestroy(() => {
		clearInterval(poll);
		clearTimeout(slowTimer);
	});
	const fmtToken = (token: { amount: bigint; nft?: { capability: string } } | undefined) =>
		token ? `${token.amount > 0n ? `${token.amount.toString()} units` : ''}${token.nft ? ` ${token.nft.capability} NFT` : ''}` : '';
	void order;
</script>

<svelte:window onkeydown={onKey} />

<div class="tx-backdrop" role="presentation">
<div class="pp-card txflow" role="dialog" aria-modal="true" aria-labelledby="txflow-title" aria-live="polite" tabindex="-1" bind:this={panel}>
	<div class="pp-card-head">
		<h2 id="txflow-title">{title ?? kindLabel[unsigned.kind]}</h2>
		<ol class="steps">
			{#each steps as step, i}
				<li class:done={i < stepIndex || stage === 'confirmed'} class:current={i === stepIndex && stage !== 'confirmed'}>{step.label}</li>
			{/each}
		</ol>
	</div>

	<ul class="summary">
		{#each unsigned.summary as line}<li>{line}</li>{/each}
	</ul>

	{#if net.realFunds}
		<p class="pp-callout bad small">
			<strong>Real money on BCH mainnet.</strong> These contracts have had no independent audit; only trade amounts you can afford to lose.
		</p>
	{/if}

	<details class="pp-details">
		<summary>Transaction details · {inputs.length} inputs · {rows.length} outputs · fee {unsigned.feeSatoshis.toString()} sats</summary>
		<div class="pp-table-wrap">
			<table class="pp-table">
				<thead><tr><th>#</th><th>Input (spends)</th><th>Unlock</th><th class="r">BCH</th><th>Token</th></tr></thead>
				<tbody>
					{#each inputs as input}
						<tr><td>{input.index}</td><td class="mono">{input.outpoint}</td><td>{input.contract}</td><td class="r">{formatBchFromSatoshis(input.sats)}</td><td class="small">{fmtToken(input.token)}</td></tr>
					{/each}
				</tbody>
			</table>
			<table class="pp-table">
				<thead><tr><th>#</th><th>Output (to)</th><th class="r">BCH</th><th>Token</th></tr></thead>
				<tbody>
					{#each rows as row}
						<tr><td>{row.index}</td><td class="mono">{row.to}{row.mine ? ' (you)' : ''}</td><td class="r">{formatBchFromSatoshis(row.sats)}</td><td class="small">{fmtToken(row.token)}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="small muted">Unsigned transaction ({unsigned.unsignedHex.length / 2} bytes):</p>
		<pre class="pp-pre">{unsigned.unsignedHex}</pre>
	</details>

	<div class="actions">
		{#if stage === 'preview' || stage === 'signing'}
			<p class="small muted">{walletLabel} will ask you to approve. It signs only; nothing is broadcast until you press Broadcast.</p>
			<div class="pp-row">
				<button type="button" class="pp-btn pp-btn-primary" onclick={sign} disabled={stage === 'signing'}>
					{stage === 'signing' ? `Waiting for approval in ${walletLabel}…` : `Sign in ${walletLabel}`}
				</button>
				<button type="button" class="pp-btn pp-btn-ghost" onclick={onDismiss} disabled={stage === 'signing'}>Discard</button>
			</div>
			{#if slow}<p class="pp-callout warn small" style="margin-top: 0.6rem">Still waiting. Open {walletLabel} on the device you paired, make sure it is on {net.label}, and look for the signing request. If the session ended, reconnect on the Wallet page.</p>{/if}
		{:else if stage === 'signed' || stage === 'broadcasting'}
			<p class="pp-callout ok small">Signed and checked: the signed transaction spends and creates exactly what was previewed. <strong>Not broadcast yet.</strong></p>
			<p class="small mono">{txid}</p>
			<div class="pp-row">
				{#if !conflict}
					<button type="button" class="pp-btn pp-btn-danger" onclick={broadcast} disabled={stage === 'broadcasting'}>
						{stage === 'broadcasting' ? 'Broadcasting…' : `Broadcast to ${net.label}`}
					</button>
				{/if}
				<button type="button" class="pp-btn pp-btn-ghost" onclick={onDismiss} disabled={stage === 'broadcasting'}>Discard signed transaction</button>
			</div>
		{:else}
			<p class="pp-callout {stage === 'confirmed' ? 'ok' : ''} small">
				{stage === 'confirmed' ? `Confirmed (${confirmations} confirmation${confirmations === 1 ? '' : 's'}).` : `Broadcast accepted. Waiting for the next ${net.label} block (checked every 20 s)…`}
				<a href={explorerTx(txid, wallet.network)} target="_blank" rel="noopener">View on explorer ↗</a>
			</p>
			<p class="small mono">{txid}</p>
			<div class="pp-row">
				{#if stage === 'broadcast'}<button type="button" class="pp-btn pp-btn-sm" onclick={checkConfirmation}>Check now</button>{/if}
				<button type="button" class="pp-btn pp-btn-sm" onclick={onDismiss}>Close</button>
			</div>
		{/if}
		{#if error}<p class="pp-error">{error}</p>{/if}
		{#if conflict && onRebuild}
			<div class="pp-row" style="margin-top: 0.5rem">
				<button type="button" class="pp-btn pp-btn-primary" onclick={onRebuild}>Rebuild with the latest state</button>
				<span class="small muted">Refreshes the book and the price, then shows a new transaction to sign.</span>
			</div>
		{/if}
	</div>
</div>
</div>

<style>
	.tx-backdrop { position: fixed; inset: 0; z-index: 60; background: rgba(20, 18, 16, 0.6); backdrop-filter: blur(2px); display: grid; place-items: center; padding: max(16px, env(safe-area-inset-top, 0px)) 16px; overflow-y: auto; animation: fade 0.15s ease-out; }
	.txflow { width: 100%; max-width: 40rem; max-height: calc(100dvh - 32px); overflow-y: auto; border-color: var(--pp-accent); box-shadow: 0 0 0 3px var(--pp-accent-soft), 0 24px 60px rgba(0, 0, 0, 0.35); outline: none; animation: pop 0.18s ease-out; }
	.txflow .pp-card-head { flex-wrap: wrap; gap: 0.5rem; }
	@keyframes fade { from { opacity: 0; } }
	@keyframes pop { from { opacity: 0; transform: translateY(8px) scale(0.98); } }
	@media (prefers-reduced-motion: reduce) { .tx-backdrop, .txflow { animation: none; } }
	.steps { display: flex; gap: 0.35rem; list-style: none; padding: 0; margin: 0; flex-wrap: wrap; }
	.steps li { font-size: 0.75rem; padding: 0.15rem 0.55rem; border-radius: 999px; background: var(--pp-surface-2); color: var(--pp-faint); border: 1px solid var(--pp-border); }
	.steps li.done { color: var(--pp-bid); background: var(--pp-bid-soft); border-color: transparent; }
	.steps li.current { color: var(--pp-accent); background: var(--pp-accent-soft); border-color: transparent; font-weight: 650; }
	.summary { margin: 0 0 0.75rem; padding-left: 1.1rem; }
	.summary li { margin: 0.15rem 0; }
	.actions { margin-top: 0.85rem; }
	.pp-table + .pp-table { margin-top: 0.75rem; }
</style>
