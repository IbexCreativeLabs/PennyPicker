<script lang="ts">
	import { onMount } from 'svelte';

	const KEY = 'pennypicker:demo-notice-v1';
	let open = $state(false);

	onMount(() => {
		try {
			open = localStorage.getItem(KEY) !== 'accepted';
		} catch {
			open = true;
		}
	});

	export function show() {
		open = true;
	}

	function accept() {
		try {
			localStorage.setItem(KEY, 'accepted');
		} catch {
			/* storage unavailable: show again next visit */
		}
		open = false;
	}
</script>

{#if open}
	<div class="backdrop" role="presentation">
		<div class="pp-card dialog" role="dialog" aria-modal="true" aria-labelledby="demo-title">
			<h2 id="demo-title">PennyPicker is an experimental hackathon demo</h2>
			<ul>
				<li><strong>Test network only.</strong> Everything runs on BCH <em>Chipnet</em>. Use a Chipnet wallet with test coins; real BCH is never involved.</li>
				<li><strong>PUSD is a test token.</strong> It is not backed by USD, has no peg and no value.</li>
				<li><strong>Operator-controlled oracle.</strong> The reference price is typed in by one operator, not taken from a market.</li>
				<li><strong>Simulations are labelled.</strong> Liquidation and redemption are pricing simulations, not working protocols.</li>
				<li><strong>You approve everything.</strong> Nothing is signed or broadcast automatically. Each transaction is shown first, signed only in your Cashonize wallet, and broadcast only when you press Broadcast.</li>
				<li><strong>Unaudited code.</strong> The contracts have not been security reviewed.</li>
			</ul>
			<p class="small muted">Found a problem? Use the <strong>Feedback</strong> button at the bottom right of every page.</p>
			<button class="pp-btn pp-btn-primary pp-btn-block" type="button" onclick={accept}>I understand. Open the demo</button>
		</div>
	</div>
{/if}

<style>
	.backdrop { position: fixed; inset: 0; z-index: 50; background: rgba(20, 18, 16, 0.55); display: grid; place-items: center; padding: max(16px, env(safe-area-inset-top, 0px)) 16px; overflow-y: auto; }
	.dialog { max-width: 34rem; width: 100%; }
	ul { padding-left: 1.1rem; margin: 0.75rem 0; }
	li { margin: 0.4rem 0; font-size: 0.93rem; }
</style>
