<script lang="ts">
	import { page } from '$app/state';

	let { children } = $props();

	const sections = [
		{ href: '/about', icon: '¢', label: 'Overview', hint: 'The idea in one minute' },
		{ href: '/about/how-it-works', icon: '⚙', label: 'How it works', hint: 'Orders, price, settlement' },
		{ href: '/about/try', icon: '▶', label: 'Try it', hint: '5 minutes, free test coins' },
		{ href: '/about/token', icon: '◎', label: 'Token', hint: 'PUSD and the markets' },
		{ href: '/about/oracle', icon: '◷', label: 'Oracle', hint: 'Live BCH/USD price' },
		{ href: '/about/mechanisms', icon: '⚖', label: 'Liquidations', hint: 'Simulations' },
		{ href: '/about/safety', icon: '⛨', label: 'Safety & status', hint: 'Risks, limits, credits' }
	];

	const current = $derived(sections.findIndex((s) => page.url.pathname === s.href || page.url.pathname === s.href + '/'));
	const prev = $derived(current > 0 ? sections[current - 1] : undefined);
	const next = $derived(current >= 0 && current < sections.length - 1 ? sections[current + 1] : undefined);
</script>

<main class="pp-container about">
	<aside class="side" aria-label="About sections">
		<p class="eyebrow">About PennyPicker</p>
		<nav>
			{#each sections as s, i (s.href)}
				<a href={s.href} class:active={i === current} aria-current={i === current ? 'page' : undefined}>
					<span class="ico" aria-hidden="true">{s.icon}</span>
					<span class="txt"><strong>{s.label}</strong><small>{s.hint}</small></span>
				</a>
			{/each}
		</nav>
	</aside>

	<div class="body">
		{@render children()}

		{#if prev || next}
			<nav class="pager" aria-label="Previous and next section">
				{#if prev}<a class="pp-card prev" href={prev.href}><small>← Previous</small><strong>{prev.label}</strong></a>{:else}<span></span>{/if}
				{#if next}<a class="pp-card next" href={next.href}><small>Next →</small><strong>{next.label}</strong></a>{/if}
			</nav>
		{/if}
	</div>
</main>

<style>
	.about { display: grid; grid-template-columns: 15rem minmax(0, 1fr); gap: 1.75rem; align-items: start; }
	.side { position: sticky; top: 5rem; }
	.eyebrow { text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.72rem; color: var(--pp-accent); font-weight: 700; margin: 0.4rem 0 0.6rem 0.4rem; }
	.side nav { display: flex; flex-direction: column; gap: 0.15rem; }
	.side a { display: flex; gap: 0.65rem; align-items: center; padding: 0.5rem 0.6rem; border-radius: 10px; color: var(--pp-text); text-decoration: none !important; }
	.side a:hover { background: var(--pp-surface-2); }
	.side a.active { background: var(--pp-accent-soft); box-shadow: inset 3px 0 0 var(--pp-accent); }
	.ico { width: 1.9rem; height: 1.9rem; flex: none; border-radius: 8px; display: grid; place-items: center; background: var(--pp-surface-2); color: var(--pp-accent); font-weight: 700; }
	.active .ico { background: var(--pp-accent); color: #fff; }
	.txt { display: flex; flex-direction: column; line-height: 1.2; }
	.txt strong { font-size: 0.92rem; font-weight: 600; }
	.txt small { font-size: 0.75rem; color: var(--pp-muted); }
	.body { min-width: 0; }
	.pager { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-top: 2rem; }
	.pager a { display: flex; flex-direction: column; gap: 0.15rem; text-decoration: none !important; color: var(--pp-text); transition: border-color 0.15s; }
	.pager a:hover { border-color: var(--pp-accent); }
	.pager small { color: var(--pp-muted); }
	.pager .next { text-align: right; grid-column: 2; }

	@media (max-width: 860px) {
		.about { grid-template-columns: minmax(0, 1fr); gap: 0.75rem; }
		.side { position: static; margin: 0 -16px; min-width: 0; }
		.eyebrow { display: none; }
		.side nav { flex-direction: row; overflow-x: auto; gap: 0.35rem; padding: 0.2rem 16px 0.5rem; scrollbar-width: none; }
		.side nav::-webkit-scrollbar { display: none; }
		.side a { flex: none; padding: 0.35rem 0.75rem 0.35rem 0.4rem; border: 1px solid var(--pp-border); border-radius: 999px; background: var(--pp-surface); }
		.side a.active { box-shadow: none; border-color: var(--pp-accent); }
		.ico { width: 1.5rem; height: 1.5rem; border-radius: 50%; font-size: 0.8rem; }
		.txt small { display: none; }
		.txt strong { font-size: 0.85rem; white-space: nowrap; }
	}
</style>
