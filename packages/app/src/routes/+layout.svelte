<script lang="ts">
	// PennyPicker renders its own shell in (pp)/+layout.svelte.
	let { children } = $props();
</script>

{@render children()}
