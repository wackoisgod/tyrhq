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
	}

	if (url.protocol === 'https:' && !LOCALHOST_HOSTNAMES.has(url.hostname)) {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000');
	}

	return response;
}
