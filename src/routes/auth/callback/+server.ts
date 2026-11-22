import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sanitizePostAuthRedirect } from '$lib/server/security';

/**
 * Map Supabase error codes to user-friendly error keys
 */
function mapErrorCode(errorCode: string | undefined): string {
	const errorMap: Record<string, string> = {
		'identity_already_exists': 'identity_already_exists',
		'manual_linking_disabled': 'manual_linking_disabled',
		'provider_disabled': 'manual_linking_disabled'
	};
	
	return errorMap[errorCode || ''] || 'link_failed';
}

export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	const error = url.searchParams.get('error');
	const errorCode = url.searchParams.get('error_code');
	const errorDescription = url.searchParams.get('error_description');
	const next = sanitizePostAuthRedirect(url.searchParams.get('next'));
	
	// Check if this is a linking flow by looking for the link marker in the callback URL
	const linkMarker = url.searchParams.get('link');
	const isLinkFlow = linkMarker === 'google';

	// Handle OAuth errors (Supabase rejected the flow before returning code)
	if (error || errorCode) {
		console.error('[auth-callback] OAuth error:', { error, errorCode, errorDescription });
		
		if (isLinkFlow) {
			// Linking-specific error - redirect to settings with mapped error
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
			// Success - check if this was a linking flow
			if (isLinkFlow) {
				// Verify user actually has Google identity now
				const { data: { user } } = await locals.supabase.auth.getUser();
				const hasGoogleIdentity = user?.identities?.some((i) => i.provider === 'google');
				
				if (hasGoogleIdentity) {
					const settingsUrl = new URL('/settings', url.origin);
					settingsUrl.searchParams.set('success', 'google_linked');
					redirect(303, settingsUrl.toString());
				}
			}
			
			// Normal sign-in or linking without verification
			redirect(303, next);
		}
		
		// Exchange failed
		console.error('[auth-callback] Exchange failed:', exchangeError);
		
		if (isLinkFlow) {
			const settingsUrl = new URL('/settings', url.origin);
			settingsUrl.searchParams.set('error', 'link_failed');
			redirect(303, settingsUrl.toString());
		}
	}

	// Fallback error - use sanitized next or default to /auth
	const fallbackNext = next || '/auth';
	const errorUrl = new URL(fallbackNext, url.origin);
	errorUrl.searchParams.set('error', 'auth_callback_failed');
	redirect(303, errorUrl.toString());
};
