/**
 * POST /auth/merge/complete
 * Completes the account merge after user has re-authenticated as secondary account
 * Verifies merge cookie, calls merge function, deletes secondary auth user
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	verifyMergeCookie,
	deleteMergeCookie,
	MERGE_COOKIE_NAME
} from '$lib/server/account-merge';

export const POST: RequestHandler = async ({ locals, cookies }) => {
	const { session, user } = await locals.safeGetSession();

	if (!session || !user) {
		throw error(401, 'Not authenticated');
	}

	// Get and verify merge cookie
	const mergeCookieValue = cookies.get(MERGE_COOKIE_NAME);
	const mergeCookie = verifyMergeCookie(mergeCookieValue);

	if (!mergeCookie) {
		throw error(400, 'Invalid or expired merge session');
	}

	const primaryUserId = mergeCookie.primaryUserId;
	const secondaryUserId = user.id;

	// Verify this is not the primary user trying to merge into themselves
	if (primaryUserId === secondaryUserId) {
		// Delete cookie
		const { value, options } = deleteMergeCookie();
		cookies.set(MERGE_COOKIE_NAME, value, options);

		throw error(400, 'Cannot merge an account into itself. Please sign in with the account you want to merge.');
	}

	// Get admin client
	const { getSupabaseAdminClient } = await import('$lib/server/supabase-admin');
	const supabaseAdmin = getSupabaseAdminClient();

	if (!supabaseAdmin) {
		throw error(500, 'Admin client not configured');
	}

	try {
		// Call the merge function
		const { data: mergeResult, error: mergeError } = await supabaseAdmin.rpc('merge_accounts', {
			p_primary_user_id: primaryUserId,
			p_secondary_user_id: secondaryUserId
		});

		if (mergeError) {
			console.error('[account-merge] Merge function failed:', mergeError);
			throw error(500, `Merge failed: ${mergeError.message}`);
		}

		// Delete the secondary auth user
		const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(secondaryUserId);

		if (deleteError) {
			console.error('[account-merge] Failed to delete secondary auth user:', deleteError);
			// Don't throw - the merge succeeded, just log the cleanup failure
			// Admin can manually delete the orphaned auth user
		}

		// Delete the merge cookie
		const { value, options } = deleteMergeCookie();
		cookies.set(MERGE_COOKIE_NAME, value, options);

		// Sign out the secondary account session
		await locals.supabase.auth.signOut();

		return json({
			success: true,
			primaryUserId,
			secondaryUserId,
			mergeResult,
			message: 'Accounts merged successfully. Please sign in to your primary account.'
		});
	} catch (err: any) {
		console.error('[account-merge] Unexpected error:', err);

		// Clean up cookie on error
		const { value, options } = deleteMergeCookie();
		cookies.set(MERGE_COOKIE_NAME, value, options);

		throw error(500, err.message || 'Unexpected error during merge');
	}
};
