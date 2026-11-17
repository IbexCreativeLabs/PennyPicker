<script lang="ts">
	import { COMMUNITY } from '$lib/pennypicker/deployment';

	let open = $state(false);
	const link = COMMUNITY.telegramUrl;
</script>

<button class="fab pp-btn pp-btn-primary" type="button" onclick={() => (open = !open)} aria-expanded={open} aria-controls="pp-chat">
	<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M21.9 4.3 18.7 19.4c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6.2 13.1l-4.8-1.5c-1-.3-1.1-1 .2-1.5L20.5 2.8c.9-.3 1.7.2 1.4 1.5Z"/></svg>
	{open ? 'Close' : 'Chat'}
</button>

{#if open}
	<section id="pp-chat" class="pp-card panel" aria-label="Community chat">
		<h2>Join the PennyPicker chat</h2>
		<p class="small muted">Questions, bug reports and trading partners for Chipnet tests: the community talks on Telegram.</p>
		<ul class="small tips">
			<li>Need test PUSD or a counterparty for a trade? Ask in the group.</li>
			<li>Reporting a problem? Include the transaction ID shown in the app.</li>
			<li>Never share seed phrases or private keys. Admins will never ask for them.</li>
		</ul>
		{#if link}
			<a class="pp-btn pp-btn-primary pp-btn-block" href={link} target="_blank" rel="noopener">Open the Telegram group ↗</a>
		{:else}
			<p class="pp-callout small">The Telegram group link will be published here soon.</p>
		{/if}
	</section>
{/if}

<style>
	.fab { position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 40; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18); border-radius: 999px; display: inline-flex; gap: 0.4rem; align-items: center; }
	.panel { position: fixed; right: 16px; bottom: calc(68px + env(safe-area-inset-bottom, 0px)); z-index: 40; width: min(24rem, calc(100vw - 32px)); max-height: calc(100vh - 120px); overflow-y: auto; }
	.panel h2 { margin-bottom: 0.4rem; }
	.tips { margin: 0.5rem 0 0.9rem; padding-left: 1.1rem; }
	.tips li { margin: 0.2rem 0; }
</style>
