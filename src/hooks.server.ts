import { createServerClient } from '@supabase/ssr';
import { redirect, type Handle } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';
import { getConfiguredSiteOrigin } from '$lib/site-url';
import { applySecurityHeaders, isAuthCallbackPath } from '$lib/server/security';

/**
 * TEMPORARY diagnostic: Vercel's runtime-log export omits client IP,
 * user-agent and referer, which is exactly what we need to tell real
 * client-router traffic from a scraper hitting `__data.json` directly.
 * Emit one structured line per data request so the logs can be filtered
 * on `[data-request]`. `x-sveltekit-invalidated` is only set by the real
 * SvelteKit client router; its absence is a cheap bot tell.
 * Remove once the traffic investigation is done.
 */
function logDataRequest(event: Parameters<Handle>[0]['event'], status: number, startedAt: number) {
	if (!event.url.pathname.endsWith('/__data.json')) return;

	let ip = 'unknown';
	try {
		ip = event.getClientAddress();
	} catch {
		// Not available in every runtime (e.g. prerender); keep going.
	}

	const headers = event.request.headers;
	console.log(
		'[data-request]',
		JSON.stringify({
			ip,
			forwardedFor: headers.get('x-forwarded-for'),
			path: event.url.pathname,
			query: event.url.search || undefined,
			status,
			durationMs: Date.now() - startedAt,
			userAgent: headers.get('user-agent'),
			referer: headers.get('referer'),
			invalidated: headers.get('x-sveltekit-invalidated'),
			hasAuthCookie: event.cookies.getAll().some((c) => c.name.startsWith('sb-'))
		})
	);
}

export const handle: Handle = async ({ event, resolve }) => {
	const startedAt = Date.now();
	const supabaseUrl = env.PUBLIC_SUPABASE_URL;
	const supabaseAnonKey = env.PUBLIC_SUPABASE_ANON_KEY;
	const configuredSiteOrigin = getConfiguredSiteOrigin();
	let hasAuthenticatedSession = false;
	const authCookieHeaders: Record<string, string> = {};
	// Any request carrying a Supabase auth cookie is treated as private even
	// if no load on this request consulted the session (e.g. a page-only
	// `__data.json` for a route whose load is fully public). Signed-in
	// visitors therefore never read from or write to the CDN cache.
	const hasAuthCookie = event.cookies.getAll().some((cookie) => cookie.name.startsWith('sb-'));

	const finalizeResponse = (response: Response) => {
		logDataRequest(event, response.status, startedAt);
		return applySecurityHeaders(response, event.url, {
			privateCache:
				hasAuthCookie || hasAuthenticatedSession || Object.keys(authCookieHeaders).length > 0,
			extraHeaders: authCookieHeaders
		});
	};

	if (configuredSiteOrigin) {
		const configuredSiteUrl = new URL(configuredSiteOrigin);
		const bareConfiguredHostname = configuredSiteUrl.hostname.startsWith('www.')
			? configuredSiteUrl.hostname.slice(4)
			: configuredSiteUrl.hostname;

		if (
			event.url.protocol === 'https:' &&
			configuredSiteUrl.hostname.startsWith('www.') &&
			event.url.hostname === bareConfiguredHostname
		) {
			const canonicalUrl = new URL(event.url);
			canonicalUrl.protocol = configuredSiteUrl.protocol;
			canonicalUrl.host = configuredSiteUrl.host;
			redirect(308, canonicalUrl.toString());
		}
	}

	if (!supabaseUrl || !supabaseAnonKey) {
		event.locals.supabase = null as unknown as SupabaseClient;
		event.locals.safeGetSession = async () => ({ session: null, user: null, role: 'user' });
		return finalizeResponse(await resolve(event));
	}

	event.locals.supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookiesToSet, headersToSet) => {
				cookiesToSet.forEach(({ name, value, options }) => {
					event.cookies.set(name, value, { ...options, path: '/' });
				});
				Object.assign(authCookieHeaders, headersToSet);
			}
		}
	});

	// Handle auth code exchange from email confirmations / OAuth at any URL
	const code = event.url.searchParams.get('code');
	if (code && !isAuthCallbackPath(event.url.pathname)) {
		const { error } = await event.locals.supabase.auth.exchangeCodeForSession(code);
		if (!error) {
			const cleanUrl = new URL(event.url);
			cleanUrl.searchParams.delete('code');
			return finalizeResponse(
				new Response(null, {
					status: 303,
					headers: { Location: cleanUrl.pathname + cleanUrl.search }
				})
			);
		}
	}

	event.locals.safeGetSession = async () => {
		const {
			data: { user },
			error
		} = await event.locals.supabase.auth.getUser();
		if (error || !user) return { session: null, user: null, role: 'user' };
		hasAuthenticatedSession = true;

		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();

		const { data: profile } = await event.locals.supabase
			.from('profiles')
			.select('role')
			.eq('id', user.id)
			.maybeSingle<{ role: 'user' | 'contributor' | 'admin' }>();

		return { session, user, role: profile?.role ?? 'user' };
	};

	return finalizeResponse(
		await resolve(event, {
			filterSerializedResponseHeaders(name) {
				return name === 'content-range' || name === 'x-supabase-api-version';
			}
		})
	);
};
