<script lang="ts">
	import { pp, explorerTx } from './session.svelte';
	import TxFlow from './TxFlow.svelte';
	import { buildIdentitySeparation, formatSats, formatUnits, type UnsignedExchangeTransaction } from '$lib/pennypicker/exchange';
	import { errorText } from './wallet';

	let pending = $state<UnsignedExchangeTransaction | undefined>();
	let error = $state('');
	let busy = $state(false);

	const head = $derived(pp.pusdIdentity);
	const own = $derived(pp.ownIdentityUtxo);
	const needsSeparation = $derived(!!own?.token && own.token.amount > 0n);

	async function review() {
		error = '';
		busy = true;
		try {
			if (!pp.wallet) throw new Error('Connect Cashonize first.');
			if (!pp.config.pusdCategory) throw new Error('PUSD category is not configured.');
			await pp.refreshWallet(); // re-resolves the identity from Chipnet
			if (!pp.pusdIdentity) throw new Error(pp.identityError || 'The PUSD identity output could not be resolved.');
			pending = buildIdentitySeparation(pp.config.pusdCategory, pp.wallet.address, pp.utxos, pp.pusdIdentity);
		} catch (cause) {
			error = errorText(cause);
		} finally {
			busy = false;
		}
	}
</script>

<section class="pp-card" style="margin-top: 1rem">
	<div class="pp-card-head">
		<h2>PUSD identity <span class="pp-badge ok plain">On-chain</span></h2>
		{#if head}<span class="pp-badge {needsSeparation ? 'warn' : 'ok'}">{needsSeparation ? 'Shares a coin with the PUSD supply' : 'Separate from PUSD'}</span>{/if}
	</div>
	<p class="small muted">
		The token's identity (who may publish its name and icon, per BCMR) lives on output 0 of the newest transaction in its authchain.
		Whoever spends that coin hands the identity to output 0 of the spending transaction, so PennyPicker never spends it in sends, orders or fills.
	</p>
	{#if pp.identityError}<p class="pp-callout warn small">{pp.identityError}</p>{/if}
	{#if head}
		<dl class="pp-kv">
			<dt>Identity output</dt><dd class="mono small"><a href={explorerTx(head.txid)} target="_blank" rel="noopener">{head.txid}:0 ↗</a></dd>
			<dt>Authchain</dt><dd class="mono small">{head.chain.map((t) => `${t.slice(0, 8)}…`).join(' → ')}</dd>
			<dt>Held by</dt><dd>{own ? 'This wallet' : 'Another address'}</dd>
			{#if own}<dt>Contents</dt><dd>{formatSats(own.satoshis)} BCH{own.token ? ` · ${formatUnits(own.token.amount)} PUSD` : ''}</dd>{/if}
		</dl>
	{:else if pp.wallet && !pp.identityError}
		<p class="muted small">Resolving from Chipnet…</p>
	{/if}

	{#if pending && pp.wallet}
		<TxFlow unsigned={pending} wallet={pp.wallet} title="Separate PUSD identity" onBroadcast={(txid, u) => pp.recordBroadcast(txid, u)} onDismiss={() => (pending = undefined)} />
	{:else if needsSeparation}
		<p class="pp-callout warn small" style="margin-top: 0.6rem">
			The whole PUSD supply sits on the identity coin, so it can't be sent or traded without moving the identity.
			A one-time self-transfer splits them: output 0 keeps the identity (BCH only), output 1 holds all PUSD. Both stay at your address.
		</p>
		<button class="pp-btn pp-btn-primary" type="button" onclick={review} disabled={busy}>{busy ? 'Checking Chipnet…' : 'Review identity separation'}</button>
	{/if}
	{#if error}<p class="pp-error">{error}</p>{/if}
</section>
