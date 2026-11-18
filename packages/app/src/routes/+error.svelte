<script lang="ts">
	import { page } from '$app/state';
	import '$lib/pennypicker/ui/theme.css';
</script>

<svelte:head><title>{page.status === 404 ? 'Page not found' : 'Error'} · PennyPicker</title></svelte:head>

<div class="pp">
<main class="pp-container err">
	<img src="/pennypicker.svg" alt="" width="56" height="56" />
	<h1>{page.status === 404 ? 'Page not found' : 'Something went wrong'}</h1>
	<p class="muted">{page.status === 404 ? 'There is no page at this address.' : page.error?.message}</p>
	<a class="pp-btn pp-btn-primary" href="/">Go to the exchange</a>
</main>
</div>

<style>
	.err { min-height: 70vh; display: grid; place-content: center; justify-items: center; text-align: center; gap: 0.6rem; }
	.err h1 { margin: 0.4rem 0 0; }
</style>
