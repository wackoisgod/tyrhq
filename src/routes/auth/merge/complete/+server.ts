/**
 * POST /auth/merge/complete
 * Completes the account merge after user has re-authenticated as secondary account
 * Verifies merge cookie, calls merge function, deletes secondary auth user
 */

import { error as httpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	verifyMergeCookie,
	deleteMergeCookie,
	MERGE_COOKIE_NAME
} from '$lib/server/account-merge';
import { getMergeSecret } from '$lib/server/account-merge';

export const POST: RequestHandler = async ({ locals, cookies, request }) => {
	const { session, user } = await locals.safeGetSession();

	if (!session || !user) {
		throw httpError(401, 'Not authenticated');
	}

	// Verify MERGE_SECRET is configured
	try {
		getMergeSecret();
	} catch (err: any) {
		console.error('[account-merge] MERGE_SECRET not configured:', err);
		throw httpError(500, 'Account merge is not configured. Please contact support.');
	}

	// Get and verify merge cookie
	const mergeCookieValue = cookies.get(MERGE_COOKIE_NAME);
	const mergeCookie = verifyMergeCookie(mergeCookieValue);

	if (!mergeCookie) {
		throw httpError(400, 'Invalid or expired merge session');
	}

	// Verify cookie is in authenticated phase
	if (mergeCookie.phase !== 'authenticated') {
		throw httpError(400, 'Merge not ready. Please complete authentication first.');
	}

	// Verify secondaryUserId matches current user
	if (!mergeCookie.secondaryUserId || mergeCookie.secondaryUserId !== user.id) {
		throw httpError(400, 'Session mismatch. Please restart the merge process.');
	}

	const primaryUserId = mergeCookie.primaryUserId;
	const secondaryUserId = mergeCookie.secondaryUserId;

	// Verify this is not the primary user trying to merge into themselves
	if (primaryUserId === secondaryUserId) {
		// Delete cookie
		const { value, options } = deleteMergeCookie();
		cookies.set(MERGE_COOKIE_NAME, value, options);

		throw httpError(400, 'Cannot merge an account into itself.');
	}

	// Get admin client
	const { getSupabaseAdminClient } = await import('$lib/server/supabase-admin');
	const supabaseAdmin = getSupabaseAdminClient();

	if (!supabaseAdmin) {
		throw httpError(500, 'Admin client not configured');
	}

	try {
		// Mark nonce as used - INSERT and treat unique violation as already used
		const { error: nonceError } = await supabaseAdmin
			.from('merge_nonces')
			.insert({ nonce: mergeCookie.nonce });

		if (nonceError) {
			// Check if it's a unique violation (nonce already used)
			if (nonceError.code === '23505' || nonceError.message?.includes('duplicate key')) {
				const { value, options } = deleteMergeCookie();
				cookies.set(MERGE_COOKIE_NAME, value, options);
				throw httpError(400, 'This merge request has already been used.');
			}
			
			console.error('[account-merge] Failed to record nonce:', nonceError);
			throw httpError(500, 'Failed to validate merge request');
		}

		// IMPORTANT: Ban secondary user BEFORE merge to prevent partial state
		// If merge fails, we can unban. If we merge first and ban fails, data is already moved.
		const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(
			secondaryUserId,
			{ ban_duration: '876000h' } // 100 years - effectively permanent until undo
		);

		if (banError) {
			console.error('[account-merge] Failed to ban secondary user:', banError);
			// Clean up nonce
			await supabaseAdmin.from('merge_nonces').delete().eq('nonce', mergeCookie.nonce);
			throw httpError(500, 'Failed to disable secondary account. Merge aborted before data move.');
		}

		// Call the merge function (moves data and identities)
		const { data: mergeResult, error: mergeError } = await supabaseAdmin.rpc('merge_accounts', {
			p_primary_user_id: primaryUserId,
			p_secondary_user_id: secondaryUserId
		});

		if (mergeError) {
			console.error('[account-merge] Merge function failed:', mergeError);
			
			// CRITICAL: Unban secondary user since merge failed
			await supabaseAdmin.auth.admin.updateUserById(
				secondaryUserId,
				{ ban_duration: 'none' }
			).catch(unbanErr => {
				console.error('[account-merge] CRITICAL: Failed to unban after merge failure:', unbanErr);
			});
			
			// Clean up nonce on failure
			await supabaseAdmin.from('merge_nonces').delete().eq('nonce', mergeCookie.nonce);
			throw httpError(500, 'Account merge failed. Secondary account has been restored.');
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
			message: 'Accounts merged successfully. Secondary account has been disabled. Please sign in to your primary account.'
		});
	} catch (err: any) {
		console.error('[account-merge] Unexpected error:', err);

		// Clean up cookie on error
		const { value, options } = deleteMergeCookie();
		cookies.set(MERGE_COOKIE_NAME, value, options);

		// Re-throw HttpError as-is
		if (err.status) {
			throw err;
		}

		throw httpError(500, 'Unexpected error during merge');
	}
};
