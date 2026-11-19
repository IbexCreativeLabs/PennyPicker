<script lang="ts">
	import { onMount } from 'svelte';

	/** Shown once per visit (browser session), and any time from the Demo badge. */
	const KEY = 'pennypicker:demo-notice-seen';
	let open = $state(false);

	onMount(() => {
		try {
			open = sessionStorage.getItem(KEY) !== '1';
		} catch {
			open = true;
		}
	});

	export function show() {
		open = true;
	}

	function accept() {
		try {
			sessionStorage.setItem(KEY, '1');
		} catch {
			/* storage unavailable: it shows again on the next page load */
		}
		open = false;
	}
</script>

{#if open}
	<div class="backdrop" role="presentation">
		<div class="pp-card dialog" role="dialog" aria-modal="true" aria-labelledby="demo-title">
			<img class="logo" src="/pennypicker-128.png" alt="" width="56" height="56" />
			<h2 id="demo-title">PennyPicker is an experimental hackathon demo</h2>
			<ul>
				<li><strong>Two markets.</strong> <em>PennyPickerUSD</em> runs on BCH Chipnet with test coins: it stands in for a USD stablecoin (1 PPUSD treated as 1 USD) and has no backing or value. <em>ParyonUSD</em> is the real stablecoin on BCH mainnet: real money, with orders capped at 25 PUSD until the contracts are independently audited. Only trade amounts you can afford to lose.</li>
				<li><strong>Real oracle price.</strong> The reference is the live BCH/USD price signed by oracles.cash (General Protocols); the contract verifies the signature.</li>
				<li><strong>You approve everything.</strong> Nothing is signed or broadcast automatically. Each transaction is shown first, signed only in your own wallet, and broadcast only when you press Broadcast.</li>
				<li><strong>Unaudited code.</strong> The contracts have had an internal security review only, no independent audit.</li>
			</ul>
			<p class="small muted">Questions or problems? Use the <strong>Chat</strong> button at the bottom right of every page.</p>
			<div class="actions">
				<button class="pp-btn pp-btn-primary" type="button" onclick={accept}>I understand. Open the demo</button>
				<a class="pp-btn" href="/about" onclick={accept}>How it works</a>
			</div>
		</div>
	</div>
{/if}

<style>
	.backdrop { position: fixed; inset: 0; z-index: 50; background: rgba(20, 18, 16, 0.55); display: grid; place-items: center; padding: max(16px, env(safe-area-inset-top, 0px)) 16px; overflow-y: auto; }
	.dialog { max-width: 34rem; width: 100%; box-shadow: var(--pp-shadow-lg); transform-origin: top center; animation: pop 0.28s var(--pp-ease); }
	.logo { display: block; margin-bottom: 0.5rem; }
	.actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.actions > * { flex: 1 1 12rem; }
	@keyframes pop { from { opacity: 0; transform: scale(0.96) translateY(6px); } }
	@media (prefers-reduced-motion: reduce) { .dialog { animation: none; } }
	ul { padding-left: 1.1rem; margin: 0.75rem 0; }
	li { margin: 0.4rem 0; font-size: 0.93rem; }
</style>
