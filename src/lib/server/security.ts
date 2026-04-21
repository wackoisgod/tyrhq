const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

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

export function applySecurityHeaders(response: Response, url: URL) {
	response.headers.set('Permissions-Policy', PERMISSIONS_POLICY);
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');

	if (url.protocol === 'https:' && !LOCALHOST_HOSTNAMES.has(url.hostname)) {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000');
	}

	return response;
}
