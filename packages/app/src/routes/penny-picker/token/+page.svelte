<script lang="ts">
	import { hexToBin } from '@bitauth/libauth';
	import {
		CHIPNET_CHAIN,
		createCashonizeClient,
		describeWalletConnectError,
		getApprovedChipnetSession,
		requestCashonizeTransactionSignature,
		requestChipnetAddresses
	} from '$lib/cashonize/walletconnect';
	import {
		buildUnsignedPusdGenesis,
		PUSD_INITIAL_AMOUNT,
		PUSD_INITIAL_SUPPLY,
		PUSD_CATEGORY_STORAGE_KEY,
		PUSD_DECIMALS,
		PUSD_NAME,
		PUSD_SYMBOL,
		PUSD_TOKEN_OUTPUT_SATOSHIS,
		buildUnsignedBchSelfTransfer,
		serializeCashonizeSourceOutputs,
		verifyBchSelfTransferSignature,
		verifyPusdGenesisSignature,
		type UnsignedBchSelfTransfer,
		type UnsignedPusdGenesis
	} from '$lib/pennypicker/pusdGenesis';
	import type { CashonizeClient, CashonizeSession } from '$lib/cashonize/walletconnect';
	import { createPusdBcmrDraft, type PusdBcmrDraft } from '$lib/pennypicker/bcmrDraft';
	import { getAddressHistoryCount, getAddressUtxos } from '$lib/pennypicker/chain';
	import { balancesOf, type Balances } from '$lib/pennypicker/ui/wallet';
	import { pp, explorerTx } from '$lib/pennypicker/ui/session.svelte';
	import IdentityCard from '$lib/pennypicker/ui/IdentityCard.svelte';
	import { CHIPNET_DEPLOYMENT } from '$lib/pennypicker/deployment';
	import { formatBchFromSatoshis, formatPusd } from '$lib/pennypicker/market';
	import { PUSD_CATEGORY_STORAGE_KEY as PUSD_KEY_FOR_BALANCE } from '$lib/pennypicker/pusdGenesis';

	let client: CashonizeClient | undefined = $state();
	let session: CashonizeSession | undefined = $state();
	let addresses = $state<string[]>([]);
	let selectedAddress = $state('');
	let genesis: UnsignedPusdGenesis | undefined = $state();
	let selfTransfer: UnsignedBchSelfTransfer | undefined = $state();
	let signedTransaction = $state('');
	let signedTransactionHash = $state('');
	let broadcastTxid = $state('');
	let outputStatus = $state('');
	let selfTransferSignedTransaction = $state('');
	let selfTransferSignedHash = $state('');
	let selfTransferBroadcastTxid = $state('');
	let selfTransferStatus = $state('');
	let selfTransferReviewConfirmed = $state(false);
	let bcmrDraft = $state<PusdBcmrDraft | undefined>();
	let autoApproveConfirmed = $state(false);
	let busy = $state(false);
	let error = $state('');
	let currentOperation = $state('');

	let balances = $state<Balances | undefined>();
	let historyCount = $state<number | undefined>();
	let balanceAddress = $state('');
	let balanceCheckedAt = $state('');
	let balanceLoading = $state(false);
	let balanceError = $state('');

	/** Re-query Electrum (Chipnet) for the selected address on every call. */
	async function loadBalances() {
		const address = selectedAddress;
		if (!address) return;
		balanceLoading = true;
		balanceError = '';
		try {
			const [utxos, count] = await Promise.all([getAddressUtxos(address), getAddressHistoryCount(address)]);
			let pusdCategory = '';
			try {
				pusdCategory = localStorage.getItem(PUSD_KEY_FOR_BALANCE) ?? '';
			} catch {
				/* storage unavailable */
			}
			balances = balancesOf(utxos, pusdCategory || undefined);
			historyCount = count;
			balanceAddress = address;
			balanceCheckedAt = new Date().toLocaleTimeString();
		} catch (cause) {
			balanceError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			balanceLoading = false;
		}
	}

	async function loadConnectedWallet() {
		busy = true;
		currentOperation = 'Connecting to the approved session…';
		error = '';
		try {
			client = await createCashonizeClient();
			session = getApprovedChipnetSession(client);
			if (!session) throw new Error('No active Cashonize Chipnet session. Connect at /cashonize first.');
			addresses = await requestChipnetAddresses(client, session);
			selectedAddress = addresses[0] ?? '';
			genesis = undefined;
			selfTransfer = undefined;
			signedTransaction = '';
			signedTransactionHash = '';
			broadcastTxid = '';
			outputStatus = '';
			selfTransferSignedTransaction = '';
			selfTransferSignedHash = '';
			selfTransferBroadcastTxid = '';
			selfTransferStatus = '';
			selfTransferReviewConfirmed = false;
			balances = undefined;
			historyCount = undefined;
			void loadBalances();
		} catch (cause) {
			error = describeWalletConnectError(cause);
		} finally {
			busy = false;
			currentOperation = '';
		}
	}

	async function prepareSelfTransfer() {
		if (!selectedAddress) return;
		busy = true;
		currentOperation = 'Reading Chipnet UTXOs and preparing an unsigned BCH-only self-transfer…';
		error = '';
		selfTransfer = undefined;
		selfTransferSignedTransaction = '';
		selfTransferSignedHash = '';
		selfTransferBroadcastTxid = '';
		selfTransferStatus = '';
		selfTransferReviewConfirmed = false;
		try {
			selfTransfer = await buildUnsignedBchSelfTransfer(selectedAddress);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
			currentOperation = '';
		}
	}

	async function requestSelfTransferSignature() {
		if (!client || !session || !selfTransfer || !selfTransferReviewConfirmed) return;
		busy = true;
		currentOperation = 'Waiting for Cashonize to review and sign the self-transfer…';
		error = '';
		try {
			const signed = await requestCashonizeTransactionSignature(
				client,
				session,
				selfTransfer.unsignedTransaction,
				serializeCashonizeSourceOutputs(selfTransfer.sourceOutputs),
				'Review the BCH-only self-transfer. It spends one confirmed UTXO and returns BCH to this Chipnet address at output 0.'
			);
			verifyBchSelfTransferSignature(
				selfTransfer.unsignedTransaction,
				signed.signedTransaction,
				signed.signedTransactionHash
			);
			selfTransferSignedTransaction = signed.signedTransaction;
			selfTransferSignedHash = signed.signedTransactionHash;
		} catch (cause) {
			error = describeWalletConnectError(cause);
		} finally {
			busy = false;
			currentOperation = '';
		}
	}

	async function broadcastSelfTransfer() {
		if (!selfTransfer || !selfTransferSignedTransaction || !selfTransferSignedHash) return;
		busy = true;
		currentOperation = 'Broadcasting the signed self-transfer to BCH Chipnet…';
		error = '';
		try {
			const txid = await selfTransfer.wallet.submitTransaction(hexToBin(selfTransferSignedTransaction), true);
			if (txid !== selfTransferSignedHash) {
				throw new Error('The Chipnet provider returned a transaction ID different from Cashonize.');
			}
			selfTransferBroadcastTxid = txid;
			selfTransferStatus = 'Broadcast accepted. Wait for confirmation, then check for BCH-only output 0.';
			pp.recordBroadcast(txid, { kind: 'self-transfer', summary: ['BCH-only self-transfer creating a vout-0 genesis input'] });
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
			currentOperation = '';
		}
	}

	async function verifySelfTransferOutput() {
		if (!selfTransfer || !selfTransferBroadcastTxid) return;
		busy = true;
		currentOperation = 'Checking for the self-transfer vout 0…';
		error = '';
		try {
			const utxos = await selfTransfer.wallet.getUtxos();
			const output = utxos.find(
				(utxo) =>
					utxo.txid === selfTransferBroadcastTxid &&
					utxo.vout === 0 &&
					!utxo.token &&
					utxo.address === selfTransfer!.address
			);
			if (!output) {
				selfTransferStatus = 'No BCH-only vout 0 is indexed yet. The transaction may still be propagating or may not have been accepted.';
			} else if (output.satoshis !== selfTransfer.outputSatoshis) {
				selfTransferStatus = 'The vout 0 UTXO amount differs from the signed preview; do not use it for genesis.';
			} else if ((output.height ?? -1) <= 0) {
				selfTransferStatus = `BCH-only vout 0 is visible in the mempool (${output.satoshis.toString()} sats), but is not confirmed yet.`;
			} else {
				selfTransferStatus = `Confirmed BCH-only vout 0 is ready for PUSD genesis: ${output.txid}:0 (${output.satoshis.toString()} sats).`;
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
			currentOperation = '';
		}
	}

	async function prepareGenesis() {
		busy = true;
		currentOperation = 'Reading Chipnet UTXOs and preparing an unsigned transaction…';
		error = '';
		genesis = undefined;
		signedTransaction = '';
		signedTransactionHash = '';
		broadcastTxid = '';
		outputStatus = '';
		try {
			if (!selectedAddress.startsWith('bchtest:')) throw new Error('Select a Cashonize BCH Chipnet address.');
			genesis = await buildUnsignedPusdGenesis(selectedAddress);
			autoApproveConfirmed = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
			currentOperation = '';
		}
	}

	async function requestSignature() {
		if (!client || !session || !genesis) return;
		busy = true;
		currentOperation = 'Waiting for the Cashonize review and signing decision…';
		error = '';
		try {
			const signed = await requestCashonizeTransactionSignature(
				client,
				session,
				genesis.unsignedTransaction,
				serializeCashonizeSourceOutputs(genesis.sourceOutputs),
				'Review the PennyPicker USD fixed-supply Chipnet token genesis transaction.'
			);
			verifyPusdGenesisSignature(
				genesis.unsignedTransaction,
				signed.signedTransaction,
				genesis.candidateCategory,
				signed.signedTransactionHash
			);
			signedTransaction = signed.signedTransaction;
			signedTransactionHash = signed.signedTransactionHash;
		} catch (cause) {
			error = describeWalletConnectError(cause);
		} finally {
			busy = false;
			currentOperation = '';
		}
	}

	async function broadcastGenesis() {
		if (!genesis || !signedTransaction || !signedTransactionHash) return;
		busy = true;
		currentOperation = 'Broadcasting the signed transaction to BCH Chipnet…';
		error = '';
		try {
			// The wallet only signed; broadcasting is a separate, explicit button action.
			const txid = await genesis.wallet.submitTransaction(hexToBin(signedTransaction), true);
			if (txid !== signedTransactionHash) {
				throw new Error('The Chipnet provider returned a transaction ID different from Cashonize.');
			}
			broadcastTxid = txid;
			outputStatus = 'Broadcast accepted by the Chipnet provider; confirmation and token UTXO verification are still pending.';
			pp.recordBroadcast(txid, { kind: 'pusd-genesis', summary: ['PUSD fixed-supply genesis'] });
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
			currentOperation = '';
		}
	}

	async function verifyOutput() {
		if (!genesis || !broadcastTxid) return;
		busy = true;
		currentOperation = 'Checking the address UTXOs…';
		error = '';
		try {
			const utxos = await genesis.wallet.getUtxos();
			const categoryOutputs = utxos.filter(
				(utxo) => utxo.txid === broadcastTxid && utxo.token?.category === genesis!.candidateCategory
			);
			const created = categoryOutputs.filter(
				(utxo) => utxo.token?.amount === PUSD_INITIAL_AMOUNT && !utxo.token.nft
			);
			if (categoryOutputs.length > 0 && created.length === 0) {
				bcmrDraft = undefined;
				outputStatus = 'A UTXO with the candidate category was found, but its amount or NFT state does not match the fixed-supply PUSD specification.';
			} else if (created.length === 0) {
				bcmrDraft = undefined;
				outputStatus = 'No PUSD output is indexed yet. The transaction may still be propagating, or it may not have been accepted.';
			} else if (created.some((utxo) => (utxo.height ?? -1) > 0)) {
				localStorage.setItem(PUSD_CATEGORY_STORAGE_KEY, genesis.candidateCategory);
				pp.reloadConfig();
				bcmrDraft = createPusdBcmrDraft(genesis.candidateCategory);
				outputStatus = `Confirmed PUSD UTXO found: ${created.map((utxo) => `${broadcastTxid}:${utxo.vout} (${utxo.token!.amount.toString()} base units, ${utxo.satoshis.toString()} sats)`).join(', ')}.`;
			} else {
				bcmrDraft = undefined;
				outputStatus = `PUSD UTXO found in the mempool: ${created.map((utxo) => `${broadcastTxid}:${utxo.vout} (${utxo.token!.amount.toString()} base units, ${utxo.satoshis.toString()} sats)`).join(', ')}. It is not confirmed yet.`;
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
			currentOperation = '';
		}
	}

	function downloadBcmrDraft() {
		if (!bcmrDraft) return;
		const blob = new Blob([bcmrDraft.json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `pusd-chipnet-bcmr-${bcmrDraft.category}.json`;
		anchor.click();
		URL.revokeObjectURL(url);
	}


	// Adopt the shared Cashonize session (from the app header) without a separate load step.
	$effect(() => {
		const w = pp.wallet;
		if (w && session?.topic !== w.session.topic) {
			client = w.client;
			session = w.session;
			addresses = [w.address];
			selectedAddress = w.address;
			void loadBalances();
		}
	});

	const pusdCategory = $derived(pp.config.pusdCategory);
	const pusdUtxos = $derived(pp.utxos.filter((u) => pusdCategory && u.token?.category === pusdCategory));
	// The committed deployment category is a confirmed genesis; a resolved authchain head also proves it exists.
	const genesisComplete = $derived(!!pusdCategory && (pusdCategory === CHIPNET_DEPLOYMENT.pusdCategory || !!pp.pusdIdentity || pusdUtxos.some((u) => (u.height ?? 0) > 0) || pp.balances.pusdUnits > 0n || (pp.discovery?.orders.some((o) => o.heldUnits > 0n) ?? false)));

	function prepareBcmrFromConfig() {
		if (pusdCategory) bcmrDraft = createPusdBcmrDraft(pusdCategory);
	}
</script>

<svelte:head>
	<title>Token · PennyPicker</title>
	<meta name="description" content="PennyPicker USD (PUSD): fixed-supply experimental CashToken on BCH Chipnet." />
</svelte:head>

<main class="pp-container">
	<div class="pp-page-head">
		<div>
			<h1>PUSD token</h1>
			<p>PennyPicker USD is a fixed-supply CashToken for testing on Chipnet. It is <strong>not</strong> backed by USD and has no peg. The ticker is also used by ParyonUSD, so always identify the token by its category.</p>
		</div>
		<span class="pp-badge {genesisComplete ? 'ok' : pusdCategory ? 'warn' : 'plain'}">{genesisComplete ? 'Deployed on Chipnet' : pusdCategory ? 'Category set, not yet seen' : 'Not deployed'}</span>
	</div>

	<div class="pp-grid-2">
		<!-- 1. Token information -->
		<section class="pp-card">
			<h2>Token</h2>
			<dl class="pp-kv">
				<dt>Name</dt><dd>{PUSD_NAME} ({PUSD_SYMBOL})</dd>
				<dt>Supply</dt><dd>{PUSD_INITIAL_SUPPLY.toLocaleString()} PUSD, fixed (no minting baton, no NFTs)</dd>
				<dt>Decimals</dt><dd>{PUSD_DECIMALS} (1 PUSD = 100 base units)</dd>
				<dt>Network</dt><dd>BCH Chipnet</dd>
				<dt>Category</dt><dd class="mono">{pusdCategory ?? '—'}</dd>
			</dl>
			{#if pusdUtxos.length}
				<details class="pp-details" style="margin-top: 0.75rem">
					<summary>PUSD outputs in your wallet ({pusdUtxos.length})</summary>
					{#each pusdUtxos as u (u.txid + u.vout)}
						<p class="small mono"><a href={explorerTx(u.txid)} target="_blank" rel="noopener">{u.txid.slice(0, 16)}…:{u.vout} ↗</a> · {formatPusd(u.token!.amount)} PUSD · {(u.height ?? 0) > 0 ? 'confirmed' : 'pending'}</p>
					{/each}
				</details>
			{/if}
		</section>

		<!-- 2–4. Wallet, balances, UTXO info -->
		<section class="pp-card">
			<div class="pp-card-head">
				<h2>Your wallet</h2>
				{#if selectedAddress}<button class="pp-btn pp-btn-sm" type="button" onclick={() => { void loadBalances(); void pp.refreshWallet(); }} disabled={balanceLoading}>{balanceLoading ? 'Refreshing…' : 'Refresh'}</button>{/if}
			</div>
			{#if !selectedAddress}
				<p class="muted">Connect Cashonize to see balances and use the tools below.</p>
				<div class="pp-row">
					<a class="pp-btn pp-btn-primary" href="/penny-picker/wallet">Connect wallet</a>
					<button class="pp-btn pp-btn-ghost" type="button" onclick={loadConnectedWallet} disabled={busy}>Use existing session</button>
				</div>
			{:else}
				{#if balances}
					<div class="pp-grid-2 bal">
						<div><div class="pp-stat-label">BCH</div><div class="pp-stat-value">{formatBchFromSatoshis(balances.bchSats)}</div><div class="small muted">{balances.bchUtxoCount} BCH-only UTXO(s) · {formatBchFromSatoshis(balances.bchSats - balances.bchConfirmedSats)} pending</div></div>
						<div><div class="pp-stat-label">PUSD</div><div class="pp-stat-value">{formatPusd(balances.pusdUnits)}</div><div class="small muted">{formatPusd(balances.pusdUnits - balances.pusdConfirmedUnits)} pending</div></div>
					</div>
					<p class="small muted" style="margin-top: 0.5rem">{balances.tokenUtxoCount} token UTXO(s) carry {formatBchFromSatoshis(balances.tokenUtxoSats)} BCH, which is not counted as spendable BCH.</p>
					{#if historyCount === 0}
						<p class="pp-callout warn small">Chipnet has never seen a transaction for this address. If Cashonize shows a balance, it belongs to a different address or wallet.</p>
					{/if}
				{:else}
					<p class="muted">Loading balances…</p>
				{/if}
				<details class="pp-details" style="margin-top: 0.6rem">
					<summary>Address details</summary>
					<dl class="pp-kv">
						<dt>Address</dt><dd class="mono">{balanceAddress || selectedAddress}</dd>
						<dt>Transactions</dt><dd>{historyCount ?? '—'}</dd>
						<dt>Checked</dt><dd>{balanceCheckedAt || '—'}</dd>
						<dt>Genesis input</dt><dd>{pp.genesisReadyUtxo ? `${pp.genesisReadyUtxo.txid.slice(0, 16)}…:0 (confirmed, BCH-only)` : 'none'}</dd>
					</dl>
					{#if addresses.length > 1}
						<label class="pp-field"><span>Address</span><select class="pp-input" bind:value={selectedAddress} disabled={busy} onchange={loadBalances}>{#each addresses as address (address)}<option value={address}>{address}</option>{/each}</select></label>
					{/if}
				</details>
				{#if balanceError}<p class="pp-error">Balance query failed: {balanceError}</p>{/if}
			{/if}
		</section>
	</div>

	<IdentityCard />

	<!-- 5. Genesis status -->
	<section class="pp-card" style="margin-top: 1rem">
		<div class="pp-card-head">
			<h2>Genesis</h2>
			<span class="pp-badge {genesisComplete ? 'ok' : 'warn'}">{genesisComplete ? 'Complete' : 'Pending'}</span>
		</div>
		{#if genesisComplete}
			<p class="pp-callout ok small">The PUSD category is set and PUSD outputs are visible on Chipnet. Nothing more is needed here.</p>
			<details class="pp-details" style="margin-top: 0.6rem">
				<summary>Token metadata (BCMR draft)</summary>
				<p class="small muted">A local BCMR-v2 file for wallets, marked experimental. It is not published or authenticated.</p>
				{#if bcmrDraft}
					<p class="small">SHA-256: <span class="mono">{bcmrDraft.sha256Hex}</span></p>
					<button class="pp-btn pp-btn-sm" type="button" onclick={downloadBcmrDraft}>Download JSON</button>
				{:else}
					<button class="pp-btn pp-btn-sm" type="button" onclick={prepareBcmrFromConfig}>Prepare draft</button>
				{/if}
			</details>
		{:else}
			<p class="small muted">Creates exactly {PUSD_INITIAL_SUPPLY.toLocaleString()} PUSD ({PUSD_INITIAL_AMOUNT.toString()} base units) with no minting baton. It spends a confirmed BCH-only output at index 0; the category ID becomes that output's transaction ID.</p>
			<button class="pp-btn pp-btn-primary" type="button" onclick={prepareGenesis} disabled={busy || !selectedAddress}>Prepare genesis</button>
		{/if}

		{#if genesis}
			<div class="flow">
				<h3>6. Transaction preview <span class="pp-badge plain">unsigned</span></h3>
				<dl class="pp-kv">
					<dt>Genesis input</dt><dd class="mono">{genesis.genesisInput.txid}:0 · {genesis.genesisInput.satoshis.toString()} sats</dd>
					<dt>Candidate category</dt><dd class="mono">{genesis.candidateCategory}</dd>
					<dt>Token output</dt><dd>{PUSD_INITIAL_SUPPLY.toString()} PUSD · {PUSD_TOKEN_OUTPUT_SATOSHIS.toString()} sats · no NFT, no minting baton</dd>
					<dt>Fee</dt><dd>{genesis.feeSatoshis.toString()} sats · {genesis.outputCount} outputs</dd>
				</dl>
				<label class="confirm"><input type="checkbox" bind:checked={autoApproveConfirmed} /> I will check the inputs, outputs and fee in Cashonize before approving.</label>
				<button class="pp-btn pp-btn-primary" type="button" onclick={requestSignature} disabled={busy || !autoApproveConfirmed}>Sign in Cashonize (no broadcast)</button>
			</div>
		{/if}
		{#if signedTransaction}
			<div class="flow">
				<h3>7. Signature <span class="pp-badge ok">signed · matches preview</span></h3>
				<p class="small mono">{signedTransactionHash}</p>
				<button class="pp-btn pp-btn-danger" type="button" onclick={broadcastGenesis} disabled={busy || !!broadcastTxid}>Broadcast PUSD genesis to Chipnet</button>
			</div>
		{/if}
		{#if broadcastTxid}
			<div class="flow">
				<h3>8. Broadcast <span class="pp-badge warn">sent</span></h3>
				<p class="small"><a href={explorerTx(broadcastTxid)} target="_blank" rel="noopener">{broadcastTxid} ↗</a></p>
				<button class="pp-btn pp-btn-sm" type="button" onclick={verifyOutput} disabled={busy}>Check PUSD output &amp; confirmation</button>
				{#if outputStatus}<p class="small" role="status">{outputStatus}</p>{/if}
				{#if bcmrDraft && !genesisComplete}<button class="pp-btn pp-btn-sm" type="button" onclick={downloadBcmrDraft}>Download BCMR draft</button>{/if}
			</div>
		{/if}
	</section>

	<!-- Genesis-input tool: only needed before PUSD exists -->
	{#if !genesisComplete}
	<section class="pp-card" style="margin-top: 1rem">
		<div class="pp-card-head">
			<h2>Genesis input (vout 0)</h2>
			<span class="pp-badge {pp.genesisReadyUtxo ? 'ok' : 'plain'}">{pp.genesisReadyUtxo ? 'Ready' : 'None available'}</span>
		</div>
		<p class="small muted">Any CashToken genesis, including PUSD and the oracle, must spend an output at index 0. This tool sends one confirmed BCH-only UTXO back to your own address as the only output, so it lands at index 0. You pay only the network fee.</p>
		{#if pp.genesisReadyUtxo}
			<p class="small">Ready: <span class="mono">{pp.genesisReadyUtxo.txid}:0</span> ({formatBchFromSatoshis(pp.genesisReadyUtxo.satoshis)} BCH, confirmed).</p>
		{:else}
			<button class="pp-btn" type="button" onclick={prepareSelfTransfer} disabled={busy || !selectedAddress}>Prepare self-transfer</button>
		{/if}
		{#if selfTransfer}
			<div class="flow">
				<h3>Preview <span class="pp-badge plain">unsigned</span></h3>
				<dl class="pp-kv">
					<dt>Spends</dt><dd class="mono">{selfTransfer.input.txid}:{selfTransfer.input.vout} · {selfTransfer.input.satoshis.toString()} sats</dd>
					<dt>Creates</dt><dd>vout 0 · {selfTransfer.outputSatoshis.toString()} sats · back to your address</dd>
					<dt>Fee</dt><dd>{selfTransfer.feeSatoshis.toString()} sats</dd>
				</dl>
				<label class="confirm"><input type="checkbox" bind:checked={selfTransferReviewConfirmed} /> I will check the source, destination and fee in Cashonize before approving.</label>
				<button class="pp-btn pp-btn-primary" type="button" onclick={requestSelfTransferSignature} disabled={busy || !selfTransferReviewConfirmed}>Sign in Cashonize (no broadcast)</button>
			</div>
		{/if}
		{#if selfTransferSignedTransaction}
			<div class="flow">
				<h3>Signed <span class="pp-badge ok">matches preview</span></h3>
				<p class="small mono">{selfTransferSignedHash}</p>
				<button class="pp-btn pp-btn-danger" type="button" onclick={broadcastSelfTransfer} disabled={busy || !!selfTransferBroadcastTxid}>Broadcast self-transfer</button>
			</div>
		{/if}
		{#if selfTransferBroadcastTxid}
			<div class="flow">
				<h3>Broadcast</h3>
				<p class="small"><a href={explorerTx(selfTransferBroadcastTxid)} target="_blank" rel="noopener">{selfTransferBroadcastTxid} ↗</a></p>
				<button class="pp-btn pp-btn-sm" type="button" onclick={verifySelfTransferOutput} disabled={busy}>Check vout 0 &amp; confirmation</button>
				{#if selfTransferStatus}<p class="small" role="status">{selfTransferStatus}</p>{/if}
			</div>
		{/if}
	</section>
	{/if}

	{#if currentOperation}<p class="pp-callout small" role="status">{currentOperation}</p>{/if}
	{#if error}<p class="pp-callout bad" role="alert">{error}</p>{/if}
	<p class="small faint" style="margin-top: 1rem">Network {CHIPNET_CHAIN}. Preparing only reads public UTXOs. Signing opens Cashonize, and broadcasting is always a separate button.</p>
</main>

<style>
	.bal { gap: 0.5rem; }
	.flow { margin-top: 1rem; padding-top: 0.85rem; border-top: 1px dashed var(--pp-border-strong); }
	.flow h3 { margin-bottom: 0.5rem; display: flex; gap: 0.5rem; align-items: center; }
	.confirm { display: flex; gap: 0.5rem; align-items: flex-start; margin: 0.65rem 0; font-size: 0.9rem; }
	.confirm input { margin-top: 0.25rem; }
</style>
