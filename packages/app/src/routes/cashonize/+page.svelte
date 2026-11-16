<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		CHIPNET_CHAIN,
		createCashonizeClient,
		describeWalletConnectError,
		disconnectCashonizeSession,
		requestCashonizeChipnetSession,
		requestChipnetAddresses,
		type CashonizeClient,
		type CashonizeSession
	} from '$lib/cashonize/walletconnect';

	let client: CashonizeClient | undefined = $state();
	let session: CashonizeSession | undefined = $state();
	let pairingUri = $state('');
	let addresses = $state<string[]>([]);
	let status = $state<'disconnected' | 'connecting' | 'connected' | 'disconnecting'>('disconnected');
	let error = $state('');
	let disposed = false;
	let watchedClient: CashonizeClient | undefined;
	let handleSessionClosed: ((event: { topic: string }) => void) | undefined;

	function clearSession(topic?: string) {
		if (topic && session?.topic !== topic) return;
		session = undefined;
		addresses = [];
		pairingUri = '';
		status = 'disconnected';
	}

	function watchSession(clientInstance: CashonizeClient) {
		if (watchedClient === clientInstance) return;
		watchedClient = clientInstance;
		handleSessionClosed = ({ topic }) => clearSession(topic);
		clientInstance.on('session_delete', handleSessionClosed);
		clientInstance.on('session_expire', handleSessionClosed);
	}

	async function connect() {
		if (status === 'connecting' || status === 'connected') return;
		status = 'connecting';
		error = '';
		pairingUri = '';

		try {
			client ??= await createCashonizeClient();
			watchSession(client);
			const { uri, approval } = await requestCashonizeChipnetSession(client);
			pairingUri = uri ?? '';
			const approvedSession = await approval();
			if (disposed) return;

			session = approvedSession;
			const connectedAddresses = await requestChipnetAddresses(client, approvedSession);
			if (disposed) return;
			addresses = connectedAddresses;
			pairingUri = '';
			status = 'connected';
		} catch (cause) {
			if (disposed) return;
			pairingUri = '';
			status = session ? 'connected' : 'disconnected';
			error = describeWalletConnectError(cause);
		}
	}

	async function disconnect() {
		if (!client || !session || status === 'disconnecting') return;
		status = 'disconnecting';
		error = '';
		const sessionToDisconnect = session;
		try {
			await disconnectCashonizeSession(client, sessionToDisconnect);
			clearSession(sessionToDisconnect.topic);
		} catch (cause) {
			status = 'connected';
			error = describeWalletConnectError(cause);
		}
	}

	onDestroy(() => {
		disposed = true;
		if (watchedClient && handleSessionClosed) {
			watchedClient.off('session_delete', handleSessionClosed);
			watchedClient.off('session_expire', handleSessionClosed);
		}
	});
</script>

<svelte:head>
	<title>Connect Cashonize on Chipnet | PennyPicker</title>
	<meta
		name="description"
		content="Connect Cashonize to PennyPicker using WalletConnect on BCH Chipnet."
	/>
</svelte:head>

<section>
	<h1>Cashonize on Chipnet</h1>
	<p>
		Connect a Cashonize wallet on BCH Chipnet to view its public address. This page does not
		access keys or create, sign, or broadcast transactions.
	</p>

	<p><strong>Network:</strong> BCH Chipnet (<code>{CHIPNET_CHAIN}</code>)</p>

	{#if session && (status === 'connected' || status === 'disconnecting')}
		<p role="status">Connected to Cashonize on BCH Chipnet.</p>
		<h2>Public BCH address{addresses.length === 1 ? '' : 'es'}</h2>
		{#if addresses.length}
			<ul>
				{#each addresses as address (address)}
					<li><code>{address}</code></li>
				{/each}
			</ul>
		{:else}
			<p>Connected, but no public Chipnet address was returned.</p>
		{/if}
		<button type="button" onclick={disconnect} disabled={status !== 'connected'}>
			{status === 'disconnecting' ? 'Disconnecting…' : 'Disconnect Cashonize'}
		</button>
	{:else}
		<button type="button" onclick={connect} disabled={status === 'connecting'}>
			{status === 'connecting' ? 'Waiting for Cashonize…' : 'Connect Cashonize'}
		</button>
	{/if}

	{#if pairingUri}
		<div class="pairing">
			<h2>Pair with Cashonize</h2>
			<p>Scan this code with Cashonize, or paste the WalletConnect URI into the wallet.</p>
			<qr-code contents={pairingUri} aria-label="WalletConnect pairing QR code"></qr-code>
			<details>
				<summary>Show pairing URI</summary>
				<textarea readonly rows="4" aria-label="WalletConnect pairing URI">{pairingUri}</textarea>
			</details>
		</div>
	{/if}

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</section>

<style>
	section {
		padding: 1rem;
	}

	button {
		padding: 0.65rem 1rem;
		font: inherit;
		cursor: pointer;
	}

	button:disabled {
		cursor: wait;
		opacity: 0.7;
	}

	.pairing {
		margin-top: 1.5rem;
		text-align: center;
	}

	qr-code {
		display: inline-block;
		width: min(75vw, 18rem);
		height: min(75vw, 18rem);
		margin: 1rem auto;
	}

	textarea {
		box-sizing: border-box;
		width: 100%;
		margin-top: 0.75rem;
		font-family: monospace;
	}

	.error {
		color: #a11212;
	}
</style>
