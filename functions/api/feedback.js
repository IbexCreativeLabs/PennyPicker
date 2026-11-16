/**
 * Cloudflare Pages Function: POST /api/feedback
 *
 * Turns a PennyPicker feedback form submission into a GitHub issue, so team
 * members can report problems without a GitHub account. The GitHub token never
 * reaches the browser.
 *
 * Required Pages environment variables (Settings → Environment variables):
 *   FEEDBACK_GITHUB_TOKEN  (secret) fine-grained PAT, repository access to the
 *                          feedback repo only, permission "Issues: Read and write".
 *   FEEDBACK_GITHUB_REPO   e.g. "IbexCreativeLabs/PennyPicker"
 * Without them the endpoint answers 503 {error: "not-configured"} and the app
 * falls back to a copyable report.
 */
const TYPES = {
	bug: 'Bug',
	ui: 'UI problem',
	confusing: 'Confusing',
	suggestion: 'Suggestion',
	transaction: 'Transaction error'
};
const MAX_BODY_BYTES = 20_000;

function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
	});
}

/** Plain text only: neutralise @mentions and #references so issues don't ping or link people. */
function clean(value, max) {
	return String(value ?? '')
		.slice(0, max)
		.replace(/\r/g, '')
		.replace(/@/g, '@​')
		.replace(/#(\d)/g, '#​$1')
		.trim();
}

export async function onRequestPost({ request, env }) {
	if (!env.FEEDBACK_GITHUB_TOKEN || !env.FEEDBACK_GITHUB_REPO) {
		return json({ ok: false, error: 'not-configured' }, 503);
	}
	// Same-origin submissions only (the app's own pages).
	const origin = request.headers.get('origin');
	if (origin && new URL(origin).host !== new URL(request.url).host) {
		return json({ ok: false, error: 'Cross-origin feedback is not accepted.' }, 403);
	}
	if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
		return json({ ok: false, error: 'Feedback is too large.' }, 413);
	}
	let input;
	try {
		const text = await request.text();
		if (text.length > MAX_BODY_BYTES) return json({ ok: false, error: 'Feedback is too large.' }, 413);
		input = JSON.parse(text);
	} catch {
		return json({ ok: false, error: 'Invalid request.' }, 400);
	}
	// Honeypot: bots fill hidden fields. Pretend success.
	if (input.website) return json({ ok: true });

	const type = Object.hasOwn(TYPES, input.type) ? input.type : 'bug';
	const message = clean(input.message, 5000);
	if (message.length < 3) return json({ ok: false, error: 'Please describe the problem.' }, 400);
	const ctx = input.context && typeof input.context === 'object' ? input.context : {};
	const firstLine = message.split('\n')[0].slice(0, 70);

	const body = [
		message,
		'',
		'---',
		`**Type:** ${TYPES[type]}`,
		input.name ? `**From:** ${clean(input.name, 80)}` : '',
		input.txid ? `**Transaction / error:** \`${clean(input.txid, 300).replace(/`/g, "'")}\`` : '',
		`**Page:** \`${clean(ctx.page, 200)}\` · **Build:** ${clean(ctx.build, 60)}`,
		`**Wallet:** ${clean(ctx.wallet, 20)}${ctx.address ? ` (\`${clean(ctx.address, 120)}\`)` : ''} · **Oracle:** ${clean(ctx.oracle, 20)}`,
		`**Browser:** ${clean(ctx.userAgent, 300)} · ${clean(ctx.viewport, 20)}`,
		'',
		'_Submitted through the PennyPicker demo feedback form._'
	]
		.filter((line) => line !== '')
		.join('\n');

	const create = (labels) =>
		fetch(`https://api.github.com/repos/${env.FEEDBACK_GITHUB_REPO}/issues`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${env.FEEDBACK_GITHUB_TOKEN}`,
				accept: 'application/vnd.github+json',
				'x-github-api-version': '2022-11-28',
				'user-agent': 'pennypicker-feedback',
				'content-type': 'application/json'
			},
			body: JSON.stringify({ title: `[${TYPES[type]}] ${firstLine}`, body, ...(labels ? { labels } : {}) })
		});

	let response = await create(['feedback', type]);
	// Labels may not be creatable with the token's permissions; retry without them.
	if (response.status === 422 || response.status === 403) response = await create(undefined);
	if (!response.ok) {
		return json({ ok: false, error: `Could not file the issue (GitHub ${response.status}).` }, 502);
	}
	const issue = await response.json();
	return json({ ok: true, number: issue.number });
}

export function onRequest() {
	return json({ ok: false, error: 'Use POST.' }, 405);
}
