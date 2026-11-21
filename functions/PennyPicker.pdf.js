const githubPdf = 'https://raw.githubusercontent.com/IbexCreativeLabs/PennyPicker/main/PennyPicker.pdf';

export async function onRequestGet({ request }) {
	const requestHeaders = new Headers();
	for (const name of ['Range', 'If-Range']) {
		const value = request.headers.get(name);
		if (value) requestHeaders.set(name, value);
	}

	let upstream;
	try {
		upstream = await fetch(githubPdf, { method: request.method, headers: requestHeaders });
	} catch {
		return new Response('The slides are unavailable from GitHub.', { status: 502 });
	}

	if (upstream.status === 416) {
		const headers = new Headers();
		const range = upstream.headers.get('Content-Range');
		if (range) headers.set('Content-Range', range);
		return new Response(null, { status: 416, headers });
	}
	if (!upstream.ok) {
		return new Response('The slides are unavailable from GitHub.', { status: 502 });
	}

	const headers = new Headers({
		'Content-Type': 'application/pdf',
		'Content-Disposition': 'inline; filename="PennyPicker.pdf"',
		'X-Content-Type-Options': 'nosniff'
	});
	for (const name of ['Accept-Ranges', 'Cache-Control', 'Content-Length', 'Content-Range', 'ETag', 'Last-Modified']) {
		const value = upstream.headers.get(name);
		if (value) headers.set(name, value);
	}
	return new Response(upstream.body, { status: upstream.status, headers });
}

export const onRequestHead = onRequestGet;
