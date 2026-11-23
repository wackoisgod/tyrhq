/**
 * Confirmation page for undoing a merge
 * Shows merge details and requires re-authentication
 */

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	verifyUnmergeCookie,
	createUnmergeCookie,
	UNMERGE_COOKIE_NAME
} from '$lib/server/account-unmerge';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const { session, user } = await locals.safeGetSession();

	if (!session || !user) {
		redirect(303, '/auth');
	}

	// Verify unmerge cookie exists and is in initiated phase
	const unmergeCookie = verifyUnmergeCookie(cookies.get(UNMERGE_COOKIE_NAME));

	if (!unmergeCookie || unmergeCookie.phase !== 'initiated') {
		redirect(303, '/settings?error=unmerge_expired');
	}

	// Verify user is the primary user
	if (unmergeCookie.primaryUserId !== user.id) {
		redirect(303, '/settings?error=unmerge_unauthorized');
	}

	// Get merge details
	const { getSupabaseAdminClient } = await import('$lib/server/supabase-admin');
	const supabaseAdmin = getSupabaseAdminClient();

	if (!supabaseAdmin) {
		redirect(303, '/settings?error=admin_unavailable');
	}

	const { data: merge } = await supabaseAdmin
		.from('account_merges')
		.select('*')
		.eq('id', unmergeCookie.mergeId)
		.single();

	if (!merge) {
		redirect(303, '/settings?error=merge_not_found');
	}

	const secondaryEmail = merge.secondary_snapshot?.user?.email || 'Unknown';
	const secondaryName = merge.secondary_snapshot?.profile?.display_name || 'Unknown';

	return {
		mergeId: unmergeCookie.mergeId,
		mergedAt: merge.merged_at,
		secondaryEmail: secondaryEmail.endsWith('@users.tyrhq.invalid') ? 'Steam Account' : secondaryEmail,
		secondaryName
	};
};
