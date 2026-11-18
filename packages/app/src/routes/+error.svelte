<script lang="ts">
	import { page } from '$app/state';
	import '$lib/pennypicker/ui/theme.css';
	import { onMount } from 'svelte';

	// A script file that failed to load (for example a cached bad copy from the moment a new version
	// was deployed) is repaired once: re-download the app's files, bypassing the cache, then reload.
	const chunkError = $derived(/dynamically imported module|importing a module script failed|error loading dynamically imported/i.test(page.error?.message ?? ''));
	let repairing = $state(false);
	onMount(async () => {
		if (!chunkError) return;
		try {
			if (sessionStorage.getItem('pennypicker:asset-repair') === '1') return;
			sessionStorage.setItem('pennypicker:asset-repair', '1');
		} catch {
			return;
		}
		repairing = true;
		const urls = new Set(
			performance
				.getEntriesByType('resource')
				.map((entry) => entry.name)
				.filter((name) => name.includes('/_app/immutable/'))
		);
		await Promise.allSettled([...urls].map((url) => fetch(url, { cache: 'reload' })));
		location.reload();
	});
</script>

<svelte:head><title>{page.status === 404 ? 'Page not found' : 'Error'} · PennyPicker</title></svelte:head>

<div class="pp">
<main class="pp-container err">
	<img src="/pennypicker.svg" alt="" width="56" height="56" />
	<h1>{page.status === 404 ? 'Page not found' : repairing ? 'Updating PennyPicker…' : 'Something went wrong'}</h1>
	<p class="muted">
		{#if page.status === 404}There is no page at this address.
		{:else if chunkError}A new version was just published. {repairing ? 'Loading it now.' : 'Please reload the page (Ctrl+Shift+R or Cmd+Shift+R).'}
		{:else}{page.error?.message}{/if}
	</p>
	<a class="pp-btn pp-btn-primary" href="/">Go to the exchange</a>
</main>
</div>

<style>
	.err { min-height: 70vh; display: grid; place-content: center; justify-items: center; text-align: center; gap: 0.6rem; }
	.err h1 { margin: 0.4rem 0 0; }
</style>
