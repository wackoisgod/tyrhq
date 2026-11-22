import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	verifyMergeCookie,
	createMergeCookie,
	MERGE_COOKIE_NAME
} from '$lib/server/account-merge';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const { session, user } = await locals.safeGetSession();

	if (!session || !user) {
		redirect(303, '/auth');
	}

	// Verify merge cookie exists and is in initiated phase
	const mergeCookie = verifyMergeCookie(cookies.get(MERGE_COOKIE_NAME));

	if (!mergeCookie || mergeCookie.phase !== 'initiated') {
		redirect(303, '/settings?error=merge_expired');
	}

	// Prevent merging into self
	if (mergeCookie.primaryUserId === user.id) {
		// Delete cookie and show error
		const { deleteMergeCookie } = await import('$lib/server/account-merge');
		const { value, options } = deleteMergeCookie();
		cookies.set(MERGE_COOKIE_NAME, value, options);
		redirect(303, '/settings?error=cannot_merge_self');
	}

	// Re-issue cookie with secondaryUserId and authenticated phase
	const { value, options } = createMergeCookie(
		mergeCookie.primaryUserId,
		user.id,
		'authenticated'
	);
	cookies.set(MERGE_COOKIE_NAME, value, options);

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

	// Don't show placeholder emails
	const secondaryEmail =
		user.email && !user.email.endsWith('@users.tyrhq.invalid') ? user.email : 'Steam Account';

	return {
		primaryEmail,
		secondaryEmail
	};
};
