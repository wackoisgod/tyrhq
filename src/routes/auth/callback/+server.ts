import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sanitizePostAuthRedirect } from '$lib/server/security';

/**
 * Map Supabase error codes to user-friendly error keys
 */
function mapErrorCode(errorCode: string | undefined): string {
	const errorMap: Record<string, string> = {
		'email_exists': 'email_exists',
		'email_not_confirmed': 'email_not_confirmed',
		'invalid_credentials': 'invalid_credentials'
	};
	
	return errorMap[errorCode || ''] || 'email_change_failed';
}

export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	const error = url.searchParams.get('error');
	const errorCode = url.searchParams.get('error_code');
	const errorDescription = url.searchParams.get('error_description');
	const next = sanitizePostAuthRedirect(url.searchParams.get('next'));
	
	// Check if this is an email linking flow by looking for the link marker
	const linkMarker = url.searchParams.get('link');
	const isEmailLinkFlow = linkMarker === 'email';

	// Handle OAuth errors (Supabase rejected the flow before returning code)
	if (error || errorCode) {
		console.error('[auth-callback] OAuth error:', { error, errorCode, errorDescription });
		
		if (isEmailLinkFlow) {
			// Email linking-specific error - redirect to settings with mapped error
			const mappedError = mapErrorCode(errorCode);
			const settingsUrl = new URL('/settings', url.origin);
			settingsUrl.searchParams.set('error', mappedError);
			redirect(303, settingsUrl.toString());
		}
		
		// General auth error
		const fallbackNext = next || '/auth';
		const errorUrl = new URL(fallbackNext, url.origin);
		errorUrl.searchParams.set('error', 'auth_callback_failed');
		redirect(303, errorUrl.toString());
	}

	// Exchange code for session
	if (code) {
		const { error: exchangeError } = await locals.supabase.auth.exchangeCodeForSession(code);
		
		if (!exchangeError) {
			// Success - check if this was an email confirmation flow
			if (isEmailLinkFlow) {
				const settingsUrl = new URL('/settings', url.origin);
				settingsUrl.searchParams.set('success', 'email_confirmed');
				redirect(303, settingsUrl.toString());
			}
			
			// Normal sign-in
			redirect(303, next);
		}
		
		// Exchange failed
		console.error('[auth-callback] Exchange failed:', exchangeError);
		
		if (isEmailLinkFlow) {
			const settingsUrl = new URL('/settings', url.origin);
			settingsUrl.searchParams.set('error', 'email_change_failed');
			redirect(303, settingsUrl.toString());
		}
	}

	// Fallback error - use sanitized next or default to /auth
	const fallbackNext = next || '/auth';
	const errorUrl = new URL(fallbackNext, url.origin);
	errorUrl.searchParams.set('error', 'auth_callback_failed');
	redirect(303, errorUrl.toString());
};
