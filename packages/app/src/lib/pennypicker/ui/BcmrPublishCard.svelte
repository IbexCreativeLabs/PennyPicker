<script lang="ts">
	import { binToHex, sha256 } from '@bitauth/libauth';
	import { pp } from './session.svelte';
	import { errorText } from './wallet';
	import TxFlow from './TxFlow.svelte';
	import { buildBcmrPublication, type UnsignedExchangeTransaction } from '$lib/pennypicker/exchange';

	/** Registry served by this site; a bare host means https://<host>/.well-known/bitcoin-cash-metadata-registry.json. */
	const REGISTRY_PATH = '/.well-known/bitcoin-cash-metadata-registry.json';
	const PUBLIC_HOST = 'pennypicker.pages.dev';

	let localHash = $state('');
	let liveHash = $state('');
	let name = $state('');
	let checkError = $state('');
	let error = $state('');
	let pending = $state<UnsignedExchangeTransaction | undefined>();
	let indexer = $state('');

	const hashOf = (text: string) => binToHex(sha256.hash(new TextEncoder().encode(text)));

	async function check() {
		checkError = '';
		try {
			const local = await (await fetch(REGISTRY_PATH, { cache: 'no-store' })).text();
			localHash = hashOf(local);
			name = JSON.parse(local).identities?.[pp.config.pusdCategory ?? '']
				? Object.values(JSON.parse(local).identities[pp.config.pusdCategory!] as Record<string, { name: string }>)[0]!.name
				: '';
			const live = await (await fetch(`https://${PUBLIC_HOST}${REGISTRY_PATH}`, { cache: 'no-store' })).text();
			liveHash = hashOf(live);
		} catch (cause) {
			checkError = errorText(cause);
		}
		try {
			const res = await fetch(`https://bcmr-chipnet.paytaca.com/api/tokens/${pp.config.pusdCategory}/`);
			const body = await res.json();
			indexer = body.name ? `${body.name} (${body.token?.symbol ?? '?'})` : body.error ?? 'unknown';
		} catch {
			indexer = 'indexer unreachable';
		}
	}

	async function prepare() {
		error = '';
		try {
			if (!pp.wallet) throw new Error('Connect the wallet that holds the PUSD identity output.');
			if (!pp.config.pusdCategory || !pp.pusdIdentity) throw new Error('The PUSD identity output is not resolved yet.');
			await check();
			if (!localHash || localHash !== liveHash) throw new Error('Deploy the registry first: the public copy must match this one byte for byte.');
			await pp.refreshWallet();
			pending = buildBcmrPublication(pp.config.pusdCategory, pp.wallet.address, pp.utxos, pp.pusdIdentity, liveHash, [PUBLIC_HOST]);
		} catch (cause) {
			error = errorText(cause);
		}
	}

	$effect(() => {
		if (pp.config.pusdCategory) void check();
	});
</script>

<section class="pp-card" style="margin-top: 1rem">
	<div class="pp-card-head">
		<h2>Token metadata (BCMR)</h2>
		<span class="pp-badge {indexer.includes('PUSD') ? 'ok' : 'warn'}">{indexer || 'checking…'}</span>
	</div>
	<p class="small muted">Wallets such as Cashonize show a token's name and icon from its BCMR registry, found through a publication in the token's identity chain. Chipnet wallets query <span class="mono">bcmr-chipnet.paytaca.com</span>.</p>
	<dl class="pp-kv">
		<dt>Registry</dt><dd class="mono small"><a href={REGISTRY_PATH} target="_blank" rel="noopener">{REGISTRY_PATH}</a> {name ? `(${name})` : ''}</dd>
		<dt>This build</dt><dd class="mono small">{localHash || '—'}</dd>
		<dt>Public copy</dt><dd class="mono small">{liveHash || '—'} {liveHash && liveHash === localHash ? '✓ matches' : liveHash ? '✗ differs (deploy first)' : ''}</dd>
		<dt>Identity output</dt><dd class="mono small">{pp.pusdIdentity ? `${pp.pusdIdentity.txid}:0` : '—'} {pp.ownIdentityUtxo ? '(in this wallet)' : ''}</dd>
	</dl>
	<p class="pp-callout small" style="margin-top: 0.6rem">
		<strong>With Cashonize:</strong> by default it refuses an app's request to spend an identity coin, so publish from the wallet itself:
		Settings → Wallet tools → Identities → <em>publish metadata</em>, location <span class="mono">pennypicker.pages.dev</span>. It fetches this file, checks the hash and spends the identity in front of you.
		The button below builds the same transaction for wallets that allow it.
	</p>
	{#if checkError}<p class="pp-error small">{checkError}</p>{/if}
	{#if pending && pp.wallet}
		<TxFlow unsigned={pending} wallet={pp.wallet} onBroadcast={(txid, u) => { pp.recordBroadcast(txid, u); pending = undefined; }} onDismiss={() => (pending = undefined)} />
	{:else}
		<div class="pp-row" style="margin-top: 0.6rem">
			<button class="pp-btn pp-btn-primary" type="button" onclick={prepare} disabled={!pp.ownIdentityUtxo}>Review metadata publication</button>
			<button class="pp-btn" type="button" onclick={check}>Re-check</button>
		</div>
		{#if !pp.ownIdentityUtxo}<p class="small muted">Connect the wallet that holds the identity output (the PUSD creator).</p>{/if}
	{/if}
	{#if error}<p class="pp-error">{error}</p>{/if}
</section>
