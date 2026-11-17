/**
 * Cloudflare Pages middleware: HTTP Basic auth for the admin area (/admin…).
 *
 * Set ADMIN_PASSWORD (and optionally ADMIN_USER, default "admin") in the Pages
 * project settings → Environment variables. Without ADMIN_PASSWORD the admin
 * area stays locked. Everything else passes through untouched.
 *
 * Note: this keeps admin pages out of public view; it is not a security
 * boundary for on-chain actions (those always require the user's own wallet).
 */
const REALM = 'PennyPicker admin';

function isAdminPath(pathname) {
	return /^\/admin(\/|\.|$)/.test(pathname);
}

function safeEqual(a, b) {
	if (typeof a !== 'string' || typeof b !== 'string') return false;
	const x = new TextEncoder().encode(a);
	const y = new TextEncoder().encode(b);
	let diff = x.length ^ y.length;
	for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
	return diff === 0;
}

export async function onRequest(context) {
	const { pathname } = new URL(context.request.url);
	if (!isAdminPath(pathname)) return context.next();

	const password = context.env.ADMIN_PASSWORD;
	if (!password) {
		return new Response('The admin area is locked: ADMIN_PASSWORD is not configured.', {
			status: 503,
			headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
		});
	}
	const user = context.env.ADMIN_USER || 'admin';
	const header = context.request.headers.get('Authorization') || '';
	if (header.startsWith('Basic ')) {
		try {
			const [givenUser, ...rest] = atob(header.slice(6)).split(':');
			if (safeEqual(givenUser, user) && safeEqual(rest.join(':'), password)) {
				const response = await context.next();
				const out = new Response(response.body, response);
				out.headers.set('Cache-Control', 'no-store');
				out.headers.set('X-Robots-Tag', 'noindex');
				return out;
			}
		} catch {
			/* malformed header: fall through */
		}
	}
	return new Response('Authentication required.', {
		status: 401,
		headers: { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`, 'Cache-Control': 'no-store' }
	});
}
