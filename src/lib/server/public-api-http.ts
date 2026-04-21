import { createHash } from 'node:crypto';

type PublicApiResponseOptions = {
	status?: number;
	etag?: string | null;
	lastModified?: string | null;
	cacheControl?: string;
};

export type PublicApiRateLimitWindow = {
	limit: number;
	used: number;
	remaining: number;
	resetAt: string;
};

export function createPublicApiEtag(seed: string) {
	const digest = createHash('sha1').update(seed).digest('base64url');
	return `W/"${digest}"`;
}

export function requestMatchesEtag(request: Request, etag: string) {
	const header = request.headers.get('if-none-match');
	if (!header) return false;

	return header
		.split(',')
		.map((value) => value.trim())
		.some((value) => value === '*' || value === etag);
}

export function createPublicApiJsonResponse(body: unknown, options: PublicApiResponseOptions = {}) {
	const headers = new Headers({
		'cache-control': options.cacheControl ?? 'private, max-age=60',
		'content-type': 'application/json; charset=utf-8'
	});

	if (options.etag) {
		headers.set('etag', options.etag);
	}

	if (options.lastModified) {
		headers.set('last-modified', options.lastModified);
	}

	return new Response(JSON.stringify(body), {
		status: options.status ?? 200,
		headers
	});
}

export function createPublicApiNotModifiedResponse(options: PublicApiResponseOptions = {}) {
	const headers = new Headers({
		'cache-control': options.cacheControl ?? 'private, max-age=60'
	});

	if (options.etag) {
		headers.set('etag', options.etag);
	}

	if (options.lastModified) {
		headers.set('last-modified', options.lastModified);
	}

	return new Response(null, {
		status: 304,
		headers
	});
}

export function createPublicApiErrorResponse(
	status: number,
	code: string,
	message: string,
	options: PublicApiResponseOptions = {}
) {
	const response = createPublicApiJsonResponse(
		{
			error: {
				code,
				message
			}
		},
		{
			...options,
			status,
			cacheControl: 'private, no-store'
		}
	);

	if (status === 401) {
		response.headers.set('www-authenticate', 'Bearer realm="Tyr HQ API"');
	}

	return response;
}

export function appendPublicApiRateLimitHeaders(
	response: Response,
	windows: {
		credentialMinute: PublicApiRateLimitWindow;
		credentialDay: PublicApiRateLimitWindow;
		ipMinute: PublicApiRateLimitWindow;
	}
) {
	response.headers.set('x-ratelimit-limit-minute', String(windows.credentialMinute.limit));
	response.headers.set('x-ratelimit-remaining-minute', String(windows.credentialMinute.remaining));
	response.headers.set('x-ratelimit-reset-minute', windows.credentialMinute.resetAt);

	response.headers.set('x-ratelimit-limit-day', String(windows.credentialDay.limit));
	response.headers.set('x-ratelimit-remaining-day', String(windows.credentialDay.remaining));
	response.headers.set('x-ratelimit-reset-day', windows.credentialDay.resetAt);

	response.headers.set('x-ratelimit-limit-ip-minute', String(windows.ipMinute.limit));
	response.headers.set('x-ratelimit-remaining-ip-minute', String(windows.ipMinute.remaining));
	response.headers.set('x-ratelimit-reset-ip-minute', windows.ipMinute.resetAt);

	return response;
}
