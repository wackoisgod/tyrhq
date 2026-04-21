import { createServerClient } from '@supabase/ssr';
import { redirect, type Handle } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';
import { getConfiguredSiteOrigin } from '$lib/site-url';
import { applySecurityHeaders, isAuthCallbackPath } from '$lib/server/security';

export const handle: Handle = async ({ event, resolve }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL;
	const supabaseAnonKey = env.PUBLIC_SUPABASE_ANON_KEY;
	const configuredSiteOrigin = getConfiguredSiteOrigin();

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
		event.locals.safeGetSession = async () => ({ session: null, user: null });
		return applySecurityHeaders(await resolve(event), event.url);
	}

	event.locals.supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookiesToSet) => {
				cookiesToSet.forEach(({ name, value, options }) => {
					event.cookies.set(name, value, { ...options, path: '/' });
				});
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
			redirect(303, cleanUrl.pathname + cleanUrl.search);
		}
	}

	event.locals.safeGetSession = async () => {
		const {
			data: { user },
			error
		} = await event.locals.supabase.auth.getUser();
		if (error || !user) return { session: null, user: null };

		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();

		return { session, user };
	};

	return applySecurityHeaders(
		await resolve(event, {
			filterSerializedResponseHeaders(name) {
				return name === 'content-range' || name === 'x-supabase-api-version';
			}
		}),
		event.url
	);
};
