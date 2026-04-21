import { redirect } from '@sveltejs/kit';
import type { EmailOtpType } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';
import { sanitizePostAuthRedirect } from '$lib/server/security';

const SUPPORTED_EMAIL_OTP_TYPES = new Set<EmailOtpType>([
	'email',
	'signup',
	'invite',
	'magiclink',
	'recovery',
	'email_change'
]);

function isSupportedEmailOtpType(value: string | null): value is EmailOtpType {
	return value !== null && SUPPORTED_EMAIL_OTP_TYPES.has(value as EmailOtpType);
}

export const GET: RequestHandler = async ({ url, locals }) => {
	const tokenHash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type');
	const next = sanitizePostAuthRedirect(url.searchParams.get('next'));

	if (!tokenHash || !isSupportedEmailOtpType(type)) {
		redirect(303, '/auth?error=auth_confirm_invalid');
	}

	const { error } = await locals.supabase.auth.verifyOtp({
		token_hash: tokenHash,
		type
	});

	if (error) {
		redirect(303, '/auth?error=auth_confirm_failed');
	}

	redirect(303, next);
};
