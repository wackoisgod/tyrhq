import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sanitizePostAuthRedirect } from '$lib/server/security';

export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	const next = sanitizePostAuthRedirect(url.searchParams.get('next'));

	if (code) {
		const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
		if (!error) {
			// If redirecting to settings, add success message for linking
			if (next === '/settings') {
				const settingsUrl = new URL('/settings', url.origin);
				settingsUrl.searchParams.set('success', 'google_linked');
				redirect(303, settingsUrl.toString());
			}
			redirect(303, next);
		}
		
		// Handle specific error cases for identity linking
		if (error) {
			console.error('[auth-callback] Exchange failed:', error);
			
			// Check if this is a linking error
			if (error.message?.includes('identity') || error.message?.includes('link')) {
				// Redirect back to settings with link_failed error
				const settingsUrl = new URL('/settings', url.origin);
				settingsUrl.searchParams.set('error', 'link_failed');
				redirect(303, settingsUrl.toString());
			}
		}
	}

	// Fallback error
	const errorUrl = new URL(next || '/auth', url.origin);
	errorUrl.searchParams.set('error', 'auth_callback_failed');
	redirect(303, errorUrl.toString());
};
