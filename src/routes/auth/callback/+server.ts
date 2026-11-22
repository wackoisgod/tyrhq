import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sanitizePostAuthRedirect } from '$lib/server/security';

/**
 * Map Supabase error codes to user-friendly error keys
 */
function mapErrorCode(errorCode: string | undefined, linkType: 'google' | 'email' | null): string {
	const errorMap: Record<string, string> = {
		// Google linking errors
		'identity_already_exists': 'identity_already_exists',
		'manual_linking_disabled': 'manual_linking_disabled',
		'provider_disabled': 'manual_linking_disabled',
		// Email linking errors
		'email_exists': 'email_exists',
		'email_not_confirmed': 'email_not_confirmed',
		'invalid_credentials': 'invalid_credentials'
	};
	
	const mapped = errorMap[errorCode || ''];
	if (mapped) return mapped;
	
	// Fallback based on link type
	return linkType === 'email' ? 'email_change_failed' : 'link_failed';
}

export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const code = url.searchParams.get('code');
	const error = url.searchParams.get('error');
	const errorCode = url.searchParams.get('error_code');
	const errorDescription = url.searchParams.get('error_description');
	const next = sanitizePostAuthRedirect(url.searchParams.get('next'));
	
	// Check if this is a linking flow by looking for the link marker in the callback URL
	const linkMarker = url.searchParams.get('link');
	const isGoogleLinkFlow = linkMarker === 'google';
	const isEmailLinkFlow = linkMarker === 'email';
	const isLinkFlow = isGoogleLinkFlow || isEmailLinkFlow;
	
	// Check if this is a merge flow
	const { verifyMergeCookie, MERGE_COOKIE_NAME } = await import('$lib/server/account-merge');
	const mergeCookie = verifyMergeCookie(cookies.get(MERGE_COOKIE_NAME));
	const isMergeFlow = mergeCookie !== null;

	// Handle OAuth errors (Supabase rejected the flow before returning code)
	if (error || errorCode) {
		console.error('[auth-callback] OAuth error:', { error, errorCode, errorDescription });
		
		if (isLinkFlow) {
			// Linking-specific error - redirect to settings with mapped error
			const linkType = isEmailLinkFlow ? 'email' : 'google';
			const mappedError = mapErrorCode(errorCode, linkType);
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
			// Check if this is a merge flow
			if (isMergeFlow) {
				// Redirect to merge confirmation page
				redirect(303, '/auth/merge/confirm');
			}
			
			// Success - check if this was a linking flow
			if (isGoogleLinkFlow) {
				// Verify user actually has Google identity now
				const { data: { user } } = await locals.supabase.auth.getUser();
				const hasGoogleIdentity = user?.identities?.some((i) => i.provider === 'google');
				
				if (hasGoogleIdentity) {
					const settingsUrl = new URL('/settings', url.origin);
					settingsUrl.searchParams.set('success', 'google_linked');
					redirect(303, settingsUrl.toString());
				}
			}
			
			if (isEmailLinkFlow) {
				// Verify user's email is now confirmed and is a real (non-placeholder) email
				const { data: { user } } = await locals.supabase.auth.getUser();
				const hasRealConfirmedEmail = 
					user?.email && 
					!user.email.endsWith('@users.tyrhq.invalid') &&
					user.email_confirmed_at;
				
				if (hasRealConfirmedEmail) {
					const settingsUrl = new URL('/settings', url.origin);
					settingsUrl.searchParams.set('success', 'email_confirmed');
					redirect(303, settingsUrl.toString());
				}
			}
			
			// Normal sign-in or linking without verification
			redirect(303, next);
		}
		
		// Exchange failed
		console.error('[auth-callback] Exchange failed:', exchangeError);
		
		if (isLinkFlow) {
			const linkType = isEmailLinkFlow ? 'email' : 'google';
			const errorKey = linkType === 'email' ? 'email_change_failed' : 'link_failed';
			const settingsUrl = new URL('/settings', url.origin);
			settingsUrl.searchParams.set('error', errorKey);
			redirect(303, settingsUrl.toString());
		}
	}

	// Fallback error - use sanitized next or default to /auth
	const fallbackNext = next || '/auth';
	const errorUrl = new URL(fallbackNext, url.origin);
	errorUrl.searchParams.set('error', 'auth_callback_failed');
	redirect(303, errorUrl.toString());
};
