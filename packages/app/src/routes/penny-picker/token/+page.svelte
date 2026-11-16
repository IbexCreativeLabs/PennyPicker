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
		PUSD_DECIMALS,
		PUSD_NAME,
		PUSD_SYMBOL,
		PUSD_TOKEN_OUTPUT_SATOSHIS,
		serializeCashonizeSourceOutputs,
		verifyPusdGenesisSignature,
		type UnsignedPusdGenesis
	} from '$lib/pennypicker/pusdGenesis';
	import type { CashonizeClient, CashonizeSession } from '$lib/cashonize/walletconnect';

	let client: CashonizeClient | undefined = $state();
	let session: CashonizeSession | undefined = $state();
	let addresses = $state<string[]>([]);
	let selectedAddress = $state('');
	let genesis: UnsignedPusdGenesis | undefined = $state();
	let signedTransaction = $state('');
	let signedTransactionHash = $state('');
	let broadcastTxid = $state('');
	let outputStatus = $state('');
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
			signedTransaction = '';
			signedTransactionHash = '';
			broadcastTxid = '';
			outputStatus = '';
		} catch (cause) {
			error = describeWalletConnectError(cause);
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
				serializeCashonizeSourceOutputs(genesis.sourceOutputs)
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
				outputStatus = 'A UTXO with the candidate category was found, but its amount or NFT state does not match the fixed-supply PUSD specification.';
			} else if (created.length === 0) {
				outputStatus = 'No PUSD output is indexed yet. The transaction may still be propagating, or it may not have been accepted.';
			} else if (created.some((utxo) => (utxo.height ?? -1) > 0)) {
				outputStatus = `Confirmed PUSD UTXO found: ${created.map((utxo) => `${broadcastTxid}:${utxo.vout} (${utxo.token!.amount.toString()} base units, ${utxo.satoshis.toString()} sats)`).join(', ')}.`;
			} else {
				outputStatus = `PUSD UTXO found in the mempool: ${created.map((utxo) => `${broadcastTxid}:${utxo.vout} (${utxo.token!.amount.toString()} base units, ${utxo.satoshis.toString()} sats)`).join(', ')}. It is not confirmed yet.`;
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
			currentOperation = '';
		}
	}

</script>

<svelte:head>
	<title>Prepare PUSD Genesis | PennyPicker</title>
	<meta name="description" content="Prepare a fixed-supply PUSD CashToken genesis transaction on BCH Chipnet." />
</svelte:head>

<main>
	<p><a href="/penny-picker">← BCH/PUSD market</a></p>
	<h1>Prepare the PUSD Chipnet token</h1>
	<p class="warning"><strong>Experimental token; no USD backing or promised peg.</strong> This flow uses BCH Chipnet. Preparing is read-only apart from fetching public UTXOs. Signing opens Cashonize only after you press the signing button. Broadcasting is a separate action.</p>

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
			<label class="checkbox"><input type="checkbox" bind:checked={autoApproveConfirmed} /> I checked Cashonize and automatic transaction approval is off for this app.</label>
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

	{#if currentOperation}<p role="status">{currentOperation}</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<section class="next">
		<h2>After genesis</h2>
		<p>The token category must be registered in a BCMR metadata registry before wallets can reliably display its name and symbol. Publishing registry metadata is a separate step and is not automated here. Genesis does not create or publish an exchange order.</p>
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
