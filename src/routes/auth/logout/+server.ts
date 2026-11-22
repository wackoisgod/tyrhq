import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, cookies }) => {
	// Clear merge cookie if present
	const { deleteMergeCookie, MERGE_COOKIE_NAME } = await import('$lib/server/account-merge');
	const { value, options } = deleteMergeCookie();
	cookies.set(MERGE_COOKIE_NAME, value, options);
	
	await locals.supabase.auth.signOut();
	redirect(303, '/');
};
