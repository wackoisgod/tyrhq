const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1']);
const PRIVATE_CACHE_CONTROL = 'private, no-cache, no-store, must-revalidate, max-age=0';

const PERMISSIONS_POLICY = [
	'accelerometer=()',
	'autoplay=()',
	'camera=()',
	'display-capture=()',
	'geolocation=()',
	'gyroscope=()',
	'magnetometer=()',
	'microphone=()',
	'payment=()',
	'usb=()'
].join(', ');

export function isAuthCallbackPath(pathname: string) {
	return pathname === '/auth/callback';
}

export function sanitizePostAuthRedirect(next: string | null | undefined) {
	if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
		return '/';
	}

	try {
		const sanitized = new URL(next, 'http://tyr-hq.local');
		if (sanitized.origin !== 'http://tyr-hq.local') return '/';
		return `${sanitized.pathname}${sanitized.search}${sanitized.hash}`;
	} catch {
		return '/';
	}
}

function appendVaryHeader(response: Response, value: string) {
	const current = response.headers.get('Vary');
	if (!current) {
		response.headers.set('Vary', value);
		return;
	}

	const existing = current.split(',').map((entry) => entry.trim().toLowerCase());
	if (!existing.includes(value.toLowerCase())) {
		response.headers.set('Vary', `${current}, ${value}`);
	}
}

export function applyPrivateCacheHeaders(response: Response) {
	response.headers.set('Cache-Control', PRIVATE_CACHE_CONTROL);
	response.headers.set('Expires', '0');
	response.headers.set('Pragma', 'no-cache');
	appendVaryHeader(response, 'Cookie');
	return response;
}

function isCdnCacheable(response: Response) {
	const cacheControl = response.headers.get('Cache-Control') ?? '';
	return /\bs-maxage=/i.test(cacheControl) && !/\b(private|no-store)\b/i.test(cacheControl);
}

type SecurityHeaderOptions = {
	privateCache?: boolean;
	extraHeaders?: Record<string, string>;
};

export function applySecurityHeaders(
	response: Response,
	url: URL,
	options: SecurityHeaderOptions = {}
) {
	response.headers.set('Permissions-Policy', PERMISSIONS_POLICY);
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');

	for (const [key, value] of Object.entries(options.extraHeaders ?? {})) {
		response.headers.set(key, value);
	}

	if (options.privateCache || response.headers.has('Set-Cookie')) {
		applyPrivateCacheHeaders(response);
	} else if (isCdnCacheable(response)) {
		// A CDN-cached anonymous response must never be handed to a request
		// carrying an auth cookie: the HTML embeds root-layout data (user,
		// profile) and would render that visitor as signed out. Vercel keys
		// its cache on Vary headers, so vary on Cookie. Data responses also
		// differ by which loads the client asked to re-run.
		appendVaryHeader(response, 'Cookie');
		if (url.pathname.endsWith('/__data.json')) {
			appendVaryHeader(response, 'x-sveltekit-invalidated');
		}
	}

	if (url.protocol === 'https:' && !LOCALHOST_HOSTNAMES.has(url.hostname)) {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000');
	}

	return response;
}
