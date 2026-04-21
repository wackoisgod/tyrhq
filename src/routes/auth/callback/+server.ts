import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sanitizePostAuthRedirect } from '$lib/server/security';

export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	const next = sanitizePostAuthRedirect(url.searchParams.get('next'));

	if (code) {
		const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
		if (!error) {
			redirect(303, next);
		}
	}

	redirect(303, '/auth?error=auth_callback_failed');
};
