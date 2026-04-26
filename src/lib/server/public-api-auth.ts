import type { RequestEvent } from '@sveltejs/kit';

import {
	findApiCredentialByKeyHash,
	hashApiKey,
	PUBLIC_API_RATE_LIMITS,
	readApiKeyFromAuthorization,
	type ApiCredentialRecord
} from './api-credentials';
import { getSupabaseAdminClient } from './supabase-admin';
import {
	appendPublicApiRateLimitHeaders,
	createPublicApiErrorResponse,
	type PublicApiRateLimitWindow
} from './public-api-http';

type AuthStatus = 'authenticated' | 'missing' | 'invalid' | 'disabled' | 'rate_limited' | 'error';

type PublicApiRequestContext = {
	credential: ApiCredentialRecord;
	ip: string | null;
	rateLimits: {
		credentialMinute: PublicApiRateLimitWindow;
		credentialDay: PublicApiRateLimitWindow;
		ipMinute: PublicApiRateLimitWindow;
	};
};

function getMinuteResetAt(now: Date) {
	return new Date(
		Date.UTC(
			now.getUTCFullYear(),
			now.getUTCMonth(),
			now.getUTCDate(),
			now.getUTCHours(),
			now.getUTCMinutes() + 1,
			0,
			0
		)
	);
}

function getMinuteWindowStart(now: Date) {
	return new Date(
		Date.UTC(
			now.getUTCFullYear(),
			now.getUTCMonth(),
			now.getUTCDate(),
			now.getUTCHours(),
			now.getUTCMinutes(),
			0,
			0
		)
	);
}

function getDayWindowStart(now: Date) {
	return new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
	);
}

function getDayResetAt(now: Date) {
	return new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0)
	);
}

function createWindow(limit: number, used: number, resetAt: Date): PublicApiRateLimitWindow {
	return {
		limit,
		used,
		remaining: Math.max(0, limit - used),
		resetAt: resetAt.toISOString()
	};
}

function resolveRequestIp(event: RequestEvent) {
	try {
		const clientAddress = event.getClientAddress();
		if (clientAddress) return clientAddress;
	} catch {
		// Fall through to trusted proxy headers when the adapter does not expose a client address.
	}

	const cloudflareIp = event.request.headers.get('cf-connecting-ip');
	if (cloudflareIp) {
		return cloudflareIp.trim();
	}

	const forwardedFor = event.request.headers.get('x-forwarded-for');
	if (forwardedFor) {
		return forwardedFor.split(',')[0]?.trim() || null;
	}

	return null;
}

async function countRequestsSince(
	filter: { apiCredentialId?: string; ip?: string },
	sinceIso: string
) {
	const admin = getSupabaseAdminClient();
	if (!admin) {
		throw new Error('Supabase admin client is not configured');
	}

	let query = admin
		.from('api_request_logs')
		.select('id', { count: 'exact', head: true })
		.gte('created_at', sinceIso);

	if (filter.apiCredentialId) {
		query = query.eq('api_credential_id', filter.apiCredentialId);
	}

	if (filter.ip) {
		query = query.eq('ip', filter.ip);
	}

	const { count, error } = await query;
	if (error) {
		throw new Error(error.message);
	}

	return count ?? 0;
}

async function logApiRequest(
	event: RequestEvent,
	options: {
		credential: ApiCredentialRecord | null;
		status: number;
		authStatus: AuthStatus;
		ip: string | null;
	}
) {
	const admin = getSupabaseAdminClient();
	if (!admin) return;

	const { error } = await admin.from('api_request_logs').insert({
		api_credential_id: options.credential?.id ?? null,
		credential_user_id: options.credential?.user_id ?? null,
		path: event.url.pathname,
		method: event.request.method,
		status_code: options.status,
		auth_status: options.authStatus,
		ip: options.ip,
		user_agent: event.request.headers.get('user-agent')
	});

	if (error) {
		console.error('[public-api] Failed to write request log', error.message);
	}
}

async function touchCredentialLastUsed(credentialId: string) {
	const admin = getSupabaseAdminClient();
	if (!admin) return;

	const { error } = await admin
		.from('api_credentials')
		.update({ last_used_at: new Date().toISOString() })
		.eq('id', credentialId);

	if (error) {
		console.error('[public-api] Failed to update credential last_used_at', error.message);
	}
}

async function rejectRequest(
	event: RequestEvent,
	options: {
		credential: ApiCredentialRecord | null;
		status: number;
		code: string;
		message: string;
		authStatus: AuthStatus;
		ip: string | null;
		rateLimits: {
			credentialMinute: PublicApiRateLimitWindow;
			credentialDay: PublicApiRateLimitWindow;
			ipMinute: PublicApiRateLimitWindow;
		};
	}
) {
	const response = appendPublicApiRateLimitHeaders(
		createPublicApiErrorResponse(options.status, options.code, options.message),
		options.rateLimits
	);

	if (options.status === 429) {
		response.headers.set('retry-after', '60');
	}

	await logApiRequest(event, {
		credential: options.credential,
		status: options.status,
		authStatus: options.authStatus,
		ip: options.ip
	});

	return response;
}

function failPublicApiRequest(caught: unknown) {
	console.error('[public-api] Failed to authenticate API request', caught);
	return createPublicApiErrorResponse(
		500,
		'internal_error',
		'The public API could not process this request.'
	);
}

export async function withPublicApiAuth(
	event: RequestEvent,
	handler: (context: PublicApiRequestContext) => Promise<Response>
) {
	const admin = getSupabaseAdminClient();
	if (!admin) {
		return createPublicApiErrorResponse(
			503,
			'api_unavailable',
			'Public API is unavailable because server configuration is incomplete.'
		);
	}

	const now = new Date();
	const minuteStartIso = getMinuteWindowStart(now).toISOString();
	const dayStartIso = getDayWindowStart(now).toISOString();
	const ip = resolveRequestIp(event);
	const emptyRateLimits = {
		credentialMinute: createWindow(PUBLIC_API_RATE_LIMITS.perMinute, 0, getMinuteResetAt(now)),
		credentialDay: createWindow(PUBLIC_API_RATE_LIMITS.perDay, 0, getDayResetAt(now)),
		ipMinute: createWindow(PUBLIC_API_RATE_LIMITS.perIpPerMinute, 0, getMinuteResetAt(now))
	};

	let ipCount = 0;
	try {
		ipCount = ip ? await countRequestsSince({ ip }, minuteStartIso) : 0;
	} catch (caught) {
		return failPublicApiRequest(caught);
	}

	const ipWindow = createWindow(
		PUBLIC_API_RATE_LIMITS.perIpPerMinute,
		Math.min(PUBLIC_API_RATE_LIMITS.perIpPerMinute, ipCount + 1),
		getMinuteResetAt(now)
	);

	if (ip && ipCount >= PUBLIC_API_RATE_LIMITS.perIpPerMinute) {
		return rejectRequest(event, {
			credential: null,
			status: 429,
			code: 'ip_rate_limit_exceeded',
			message: 'Too many requests from this IP address. Try again shortly.',
			authStatus: 'rate_limited',
			ip,
			rateLimits: {
				...emptyRateLimits,
				ipMinute: ipWindow
			}
		});
	}

	const apiKey = readApiKeyFromAuthorization(event.request.headers.get('authorization'));
	if (!apiKey) {
		return rejectRequest(event, {
			credential: null,
			status: 401,
			code: 'missing_api_key',
			message: 'Provide an API key using Authorization: Bearer <key>.',
			authStatus: 'missing',
			ip,
			rateLimits: {
				...emptyRateLimits,
				ipMinute: ipWindow
			}
		});
	}

	let credential: ApiCredentialRecord | null;
	try {
		credential = await findApiCredentialByKeyHash(hashApiKey(apiKey));
	} catch (caught) {
		return failPublicApiRequest(caught);
	}

	if (!credential) {
		return rejectRequest(event, {
			credential: null,
			status: 401,
			code: 'invalid_api_key',
			message: 'The provided API key is invalid.',
			authStatus: 'invalid',
			ip,
			rateLimits: {
				...emptyRateLimits,
				ipMinute: ipWindow
			}
		});
	}

	if (credential.status !== 'active' || !credential.key_hash) {
		return rejectRequest(event, {
			credential,
			status: 403,
			code: 'api_key_disabled',
			message: 'The provided API key has been disabled.',
			authStatus: 'disabled',
			ip,
			rateLimits: {
				...emptyRateLimits,
				ipMinute: ipWindow
			}
		});
	}

	let credentialMinuteCount = 0;
	let credentialDayCount = 0;
	try {
		[credentialMinuteCount, credentialDayCount] = await Promise.all([
			countRequestsSince({ apiCredentialId: credential.id }, minuteStartIso),
			countRequestsSince({ apiCredentialId: credential.id }, dayStartIso)
		]);
	} catch (caught) {
		return failPublicApiRequest(caught);
	}

	const rateLimits = {
		credentialMinute: createWindow(
			PUBLIC_API_RATE_LIMITS.perMinute,
			Math.min(PUBLIC_API_RATE_LIMITS.perMinute, credentialMinuteCount + 1),
			getMinuteResetAt(now)
		),
		credentialDay: createWindow(
			PUBLIC_API_RATE_LIMITS.perDay,
			Math.min(PUBLIC_API_RATE_LIMITS.perDay, credentialDayCount + 1),
			getDayResetAt(now)
		),
		ipMinute: ipWindow
	};

	if (
		credentialMinuteCount >= PUBLIC_API_RATE_LIMITS.perMinute ||
		credentialDayCount >= PUBLIC_API_RATE_LIMITS.perDay
	) {
		return rejectRequest(event, {
			credential,
			status: 429,
			code: 'rate_limit_exceeded',
			message: 'API rate limit exceeded for this key. Try again after the reset window.',
			authStatus: 'rate_limited',
			ip,
			rateLimits
		});
	}

	try {
		const response = appendPublicApiRateLimitHeaders(
			await handler({
				credential,
				ip,
				rateLimits
			}),
			rateLimits
		);

		await Promise.allSettled([
			logApiRequest(event, {
				credential,
				status: response.status,
				authStatus: 'authenticated',
				ip
			}),
			touchCredentialLastUsed(credential.id)
		]);

		return response;
	} catch (caught) {
		console.error('[public-api] Unhandled API error', caught);

		const response = appendPublicApiRateLimitHeaders(
			createPublicApiErrorResponse(
				500,
				'internal_error',
				'The public API could not process this request.'
			),
			rateLimits
		);

		await logApiRequest(event, {
			credential,
			status: 500,
			authStatus: 'error',
			ip
		});

		return response;
	}
}
