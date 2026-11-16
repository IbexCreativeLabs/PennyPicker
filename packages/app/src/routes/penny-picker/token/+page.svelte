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

</script>

<svelte:head>
	<title>Prepare PUSD Genesis | PennyPicker</title>
	<meta name="description" content="Prepare a fixed-supply PUSD CashToken genesis transaction on BCH Chipnet." />
</svelte:head>

<main>
	<p><a href="/penny-picker">← BCH/PUSD market</a></p>
	<h1>Prepare the PUSD Chipnet token</h1>
	<p class="warning"><strong>Experimental token; no USD backing or promised peg.</strong> PennyPicker's PUSD is separate from ParyonUSD, which also uses the PUSD ticker on BCH. Confirm the exact category before sending or trading any PUSD. This flow uses BCH Chipnet. Preparing is read-only apart from fetching public UTXOs. Signing opens Cashonize only after you press the signing button. Broadcasting is a separate action.</p>

	<section>
		<h2>Token specification</h2>
		<dl>
			<dt>Name</dt><dd>{PUSD_NAME}</dd>
			<dt>Symbol</dt><dd>{PUSD_SYMBOL}</dd>
			<dt>Initial supply</dt><dd>{PUSD_INITIAL_SUPPLY.toLocaleString()} PUSD</dd>
			<dt>Decimals</dt><dd>{PUSD_DECIMALS}</dd>
			<dt>Minting baton</dt><dd>None; fixed supply</dd>
			<dt>Network</dt><dd>BCH Chipnet (<code>{CHIPNET_CHAIN}</code>)</dd>
		</dl>
	</section>

	<section>
		<h2>1. Connect the existing Cashonize session</h2>
		<p>Use the <a href="/cashonize">Cashonize connection page</a> first if no session is active. The market app creates a watch-only reader from the public address; Vox never loads wallet keys.</p>
		<button type="button" onclick={loadConnectedWallet} disabled={busy}>Load connected Cashonize address</button>
		{#if addresses.length}
			<label>Public Chipnet address
				<select bind:value={selectedAddress} disabled={busy}>
					{#each addresses as address (address)}<option value={address}>{address}</option>{/each}
				</select>
			</label>
		{/if}
		<button type="button" onclick={prepareGenesis} disabled={busy || !selectedAddress}>Prepare unsigned genesis</button>
	</section>

	<section>
		<h2>Optional prerequisite: create a BCH-only vout 0</h2>
		<p>CashTokens genesis requires spending a transaction output at index 0. If this address has no confirmed BCH-only vout 0, prepare a one-input self-transfer first. It returns the selected BCH-only UTXO to this same address as its only output. Preparation is unsigned; Cashonize signing and broadcasting each require a separate action.</p>
		<button type="button" onclick={prepareSelfTransfer} disabled={busy || !selectedAddress}>Prepare unsigned vout-0 self-transfer</button>
	</section>

	{#if selfTransfer}
		<section class="preview">
			<h2>Unsigned BCH-only self-transfer</h2>
			<dl>
				<dt>Input</dt><dd><code>{selfTransfer.input.txid}:{selfTransfer.input.vout}</code> · {selfTransfer.input.satoshis.toString()} sats · confirmed BCH only</dd>
				<dt>Output</dt><dd>vout 0 · {selfTransfer.outputSatoshis.toString()} sats · same Cashonize Chipnet address</dd>
				<dt>Estimated miner fee</dt><dd>{selfTransfer.feeSatoshis.toString()} sats</dd>
			</dl>
			<label class="checkbox"><input type="checkbox" bind:checked={selfTransferReviewConfirmed} /> Automatic approval is disabled in Cashonize; I will verify the source UTXO, vout 0 destination and fee in Cashonize before approving.</label>
			<button type="button" onclick={requestSelfTransferSignature} disabled={busy || !selfTransferReviewConfirmed}>Request Cashonize signature (no broadcast)</button>
		</section>
	{/if}

	{#if selfTransferSignedTransaction}
		<section class="preview">
			<h2>Self-transfer signed, not broadcast</h2>
			<p>Cashonize returned a signed transaction. Its input and sole BCH-only output match the preview; it has not been broadcast. Transaction ID: <code>{selfTransferSignedHash}</code></p>
			<button class="broadcast" type="button" onclick={broadcastSelfTransfer} disabled={busy}>Broadcast self-transfer to Chipnet</button>
		</section>
	{/if}

	{#if selfTransferBroadcastTxid}
		<section>
			<h2>Self-transfer status</h2>
			<p>Provider accepted transaction: <code>{selfTransferBroadcastTxid}</code></p>
			<button type="button" onclick={verifySelfTransferOutput} disabled={busy}>Check BCH-only vout 0 and confirmation</button>
			<p role="status">{selfTransferStatus}</p>
		</section>
	{/if}

	{#if genesis}
		<section class="preview">
			<h2>Unsigned transaction preview</h2>
			<p>This is prepared but unsigned. Category below is only a candidate derived from the genesis input; it does not exist as a deployed token until the transaction is confirmed.</p>
			<dl>
				<dt>Genesis input</dt><dd><code>{genesis.genesisInput.txid}:0</code> · {genesis.genesisInput.satoshis.toString()} satoshis · BCH only</dd>
				<dt>Candidate category</dt><dd><code>{genesis.candidateCategory}</code></dd>
				<dt>Token output</dt><dd>{PUSD_INITIAL_SUPPLY.toString()} PUSD · {PUSD_TOKEN_OUTPUT_SATOSHIS.toString()} satoshis · no NFT/minting baton</dd>
				<dt>Estimated transaction fee</dt><dd>{genesis.feeSatoshis.toString()} satoshis</dd>
				<dt>Transaction outputs</dt><dd>{genesis.outputCount}</dd>
			</dl>
			<p class="caution">Review all inputs, outputs, fees and network in Cashonize. Do not sign if the wallet preview differs from this summary.</p>
			<label class="checkbox"><input type="checkbox" bind:checked={autoApproveConfirmed} /> Automatic approval is disabled in Cashonize; I will verify all inputs, outputs and fees in Cashonize before approving.</label>
			<button type="button" onclick={requestSignature} disabled={busy || !autoApproveConfirmed}>Request Cashonize signature (no broadcast)</button>
		</section>
	{/if}

	{#if signedTransaction}
		<section class="preview">
			<h2>Signed, not broadcast</h2>
			<p>Cashonize returned a signed transaction. The app checked that all outpoints and outputs still match the unsigned preview. It has not been broadcast.</p>
			<p>Transaction ID: <code>{signedTransactionHash}</code></p>
			<button class="broadcast" type="button" onclick={broadcastGenesis} disabled={busy}>Broadcast PUSD genesis to Chipnet</button>
		</section>
	{/if}

	{#if broadcastTxid}
		<section>
			<h2>Broadcast status</h2>
			<p>Provider accepted transaction: <code>{broadcastTxid}</code></p>
			<button type="button" onclick={verifyOutput} disabled={busy}>Check PUSD UTXO and confirmation</button>
			<p role="status">{outputStatus}</p>
		</section>
	{/if}

	{#if bcmrDraft}
		<section class="preview">
			<h2>BCMR metadata draft</h2>
			<p>A confirmed PUSD category was found, so PennyPicker prepared a BCMR-v2 JSON file for that category. This local draft is not published or authenticated; wallets will not discover it automatically.</p>
			<p>SHA-256 of the exact downloaded bytes: <code>{bcmrDraft.sha256Hex}</code></p>
			<button type="button" onclick={downloadBcmrDraft}>Download BCMR JSON draft</button>
		</section>
	{/if}

	{#if currentOperation}<p role="status">{currentOperation}</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<section class="next">
		<h2>After genesis</h2>
		<p>The metadata draft is for review or manual import. Public publication still requires hosting the exact JSON bytes and choosing an authenticated registry identity/authchain; this app does not upload or publish it. Genesis does not create or publish an exchange order.</p>
	</section>
</main>

<style>
	main { max-width: 55rem; margin: 0 auto; padding: 1.25rem; }
	h1 { font-size: clamp(1.8rem, 4vw, 2.5rem); }
	section { margin: 1rem 0; padding: 1rem; background: #ffffffd4; border-radius: 0.65rem; }
	.warning, .caution { background: #fff2d7; border-left: 4px solid #bc7610; padding: 0.8rem; }
	.caution { border-color: #a11212; }
	dl { display: grid; grid-template-columns: minmax(9rem, 0.35fr) 1fr; gap: 0.55rem 1rem; }
	dt { font-weight: 700; }
	dd { margin: 0; overflow-wrap: anywhere; }
	button, select { min-height: 2.6rem; padding: 0.5rem 0.8rem; margin: 0.35rem 0.5rem 0.35rem 0; font: inherit; }
	button { cursor: pointer; }
	button:disabled { cursor: not-allowed; opacity: 0.55; }
	label { display: block; margin: 0.8rem 0; }
	.checkbox { display: flex; align-items: flex-start; gap: 0.5rem; }
	.checkbox input { margin-top: 0.3rem; }
	.broadcast { background: #8a291f; color: white; border: 0; border-radius: 0.35rem; }
	.preview { border: 2px solid #a66b17; }
	.error { color: #a11212; }
	.next { opacity: 0.9; }
</style>
