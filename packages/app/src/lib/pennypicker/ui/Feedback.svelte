<script lang="ts">
	import { page } from '$app/state';
	import { pp } from './session.svelte';

	const TYPES = [
		{ id: 'bug', label: 'Bug' },
		{ id: 'ui', label: 'UI problem' },
		{ id: 'confusing', label: 'Confusing' },
		{ id: 'suggestion', label: 'Suggestion' },
		{ id: 'transaction', label: 'Transaction error' }
	] as const;
	const REPO_ISSUES_URL = 'https://github.com/IbexCreativeLabs/PennyPicker/issues/new';
	const build = __PENNYPICKER_BUILD__;

	let open = $state(false);
	let type = $state<(typeof TYPES)[number]['id']>('bug');
	let message = $state('');
	let txid = $state('');
	let name = $state('');
	let includeAddress = $state(false);
	let website = $state(''); // honeypot: humans leave it empty
	let status = $state<'idle' | 'sending' | 'sent' | 'fallback' | 'error'>('idle');
	let result = $state('');
	let copied = $state(false);

	const context = $derived({
		page: page.url.pathname,
		build: `${build.commit} (${build.branch})`,
		wallet: pp.walletStatus,
		address: includeAddress ? pp.wallet?.address : undefined,
		oracle: pp.oracle ? `#${pp.oracle.state.sequence}` : 'none',
		viewport: typeof window === 'undefined' ? '' : `${window.innerWidth}x${window.innerHeight}`,
		userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent
	});

	const report = $derived(
		[
			`Type: ${TYPES.find((t) => t.id === type)?.label}`,
			name.trim() ? `From: ${name.trim()}` : '',
			'',
			message.trim(),
			'',
			txid.trim() ? `Transaction: ${txid.trim()}` : '',
			`Page: ${context.page} · Build: ${context.build} · Wallet: ${context.wallet}${context.address ? ` (${context.address})` : ''} · Oracle: ${context.oracle}`,
			`Browser: ${context.userAgent} · ${context.viewport}`
		]
			.filter((line, i, all) => line !== '' || (all[i - 1] ?? '') !== '')
			.join('\n')
	);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (message.trim().length < 3) return;
		status = 'sending';
		result = '';
		try {
			const response = await fetch('/api/feedback', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ type, message: message.trim(), txid: txid.trim(), name: name.trim(), website, context })
			});
			const data = (await response.json().catch(() => ({}))) as { ok?: boolean; number?: number; error?: string };
			if (response.ok && data.ok) {
				status = 'sent';
				result = data.number ? `Thanks! Filed as issue #${data.number}.` : 'Thanks! Your feedback was sent.';
				message = '';
				txid = '';
			} else if (response.status === 404 || response.status === 405 || data.error === 'not-configured') {
				status = 'fallback';
			} else {
				status = 'error';
				result = data.error ?? `Feedback service returned ${response.status}.`;
			}
		} catch {
			status = 'fallback';
		}
	}

	async function copy() {
		try {
			await navigator.clipboard.writeText(report);
			copied = true;
		} catch {
			copied = false;
		}
	}

	const issueLink = $derived(
		`${REPO_ISSUES_URL}?title=${encodeURIComponent(`[${type}] ${message.trim().split('\n')[0]?.slice(0, 70) ?? ''}`)}&body=${encodeURIComponent(report)}`
	);
</script>

<button class="fab pp-btn pp-btn-primary" type="button" onclick={() => (open = !open)} aria-expanded={open}>
	{open ? 'Close' : 'Feedback'}
</button>

{#if open}
	<section class="pp-card panel" aria-label="Send feedback">
		<h2>Send feedback</h2>
		{#if status === 'sent'}
			<p class="pp-callout ok">{result}</p>
			<button class="pp-btn pp-btn-sm" type="button" onclick={() => (status = 'idle')}>Send more</button>
		{:else if status === 'fallback'}
			<p class="pp-callout warn small">The feedback service isn't available on this deployment. Copy the report below and send it to the team, or open a GitHub issue if you have repository access.</p>
			<textarea class="pp-input report" readonly rows="8">{report}</textarea>
			<div class="pp-row">
				<button class="pp-btn pp-btn-sm" type="button" onclick={copy}>{copied ? 'Copied ✓' : 'Copy report'}</button>
				<a class="pp-btn pp-btn-sm" href={issueLink} target="_blank" rel="noopener">GitHub issue ↗</a>
				<button class="pp-btn pp-btn-ghost pp-btn-sm" type="button" onclick={() => (status = 'idle')}>Back</button>
			</div>
		{:else}
			<form class="pp-stack" onsubmit={submit}>
				<div class="types">
					{#each TYPES as t}
						<button type="button" class="pp-btn pp-btn-sm" class:sel={type === t.id} onclick={() => (type = t.id)}>{t.label}</button>
					{/each}
				</div>
				<label class="pp-field"><span>What happened or what would you change?</span><textarea class="pp-input" rows="5" maxlength="5000" required bind:value={message}></textarea></label>
				{#if type === 'transaction' || type === 'bug'}
					<label class="pp-field"><span>Transaction ID (optional)</span><input class="pp-input mono" bind:value={txid} placeholder="txid or error text" /></label>
				{/if}
				<label class="pp-field"><span>Your name (optional)</span><input class="pp-input" maxlength="80" bind:value={name} /></label>
				{#if pp.wallet}<label class="small"><input type="checkbox" bind:checked={includeAddress} /> Include my Chipnet address</label>{/if}
				<input class="hp" tabindex="-1" autocomplete="off" aria-hidden="true" bind:value={website} />
				<p class="pp-hint">Page, app version and browser are attached automatically. No GitHub account needed.</p>
				{#if status === 'error'}<p class="pp-error small">{result}</p>{/if}
				<button class="pp-btn pp-btn-primary" type="submit" disabled={status === 'sending' || message.trim().length < 3}>{status === 'sending' ? 'Sending…' : 'Send feedback'}</button>
			</form>
		{/if}
	</section>
{/if}

<style>
	.fab { position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 40; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18); border-radius: 999px; }
	.panel { position: fixed; right: 16px; bottom: calc(68px + env(safe-area-inset-bottom, 0px)); z-index: 40; width: min(26rem, calc(100vw - 32px)); max-height: calc(100vh - 120px); overflow-y: auto; }
	.panel h2 { margin-bottom: 0.6rem; }
	.types { display: flex; flex-wrap: wrap; gap: 0.3rem; }
	.types .sel { border-color: var(--pp-accent); color: var(--pp-accent); background: var(--pp-accent-soft); }
	.report { font-family: var(--pp-mono); font-size: 0.75rem; margin: 0.5rem 0; }
	.hp { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
</style>
