import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { verifyMergeCookie, MERGE_COOKIE_NAME } from '$lib/server/account-merge';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const { session, user } = await locals.safeGetSession();

	if (!session || !user) {
		redirect(303, '/auth');
	}

	// Verify merge cookie exists
	const mergeCookie = verifyMergeCookie(cookies.get(MERGE_COOKIE_NAME));

	if (!mergeCookie) {
		redirect(303, '/settings?error=merge_expired');
	}

	// Get primary user info
	const { getSupabaseAdminClient } = await import('$lib/server/supabase-admin');
	const supabaseAdmin = getSupabaseAdminClient();

	let primaryEmail = 'Unknown';

	if (supabaseAdmin) {
		const { data: primaryUser } = await supabaseAdmin.auth.admin.getUserById(
			mergeCookie.primaryUserId
		);
		primaryEmail = primaryUser?.user?.email || 'Unknown';
	}

	return {
		primaryEmail,
		secondaryEmail: user.email
	};
};
