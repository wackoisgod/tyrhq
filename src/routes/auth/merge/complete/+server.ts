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
		// Check nonce - prevent replay
		const { data: existingNonce } = await supabaseAdmin
			.from('merge_nonces')
			.select('nonce')
			.eq('nonce', mergeCookie.nonce)
			.maybeSingle();

		if (existingNonce) {
			// Nonce already used
			const { value, options } = deleteMergeCookie();
			cookies.set(MERGE_COOKIE_NAME, value, options);
			throw httpError(400, 'This merge request has already been used.');
		}

		// Mark nonce as used
		const { error: nonceError } = await supabaseAdmin
			.from('merge_nonces')
			.insert({ nonce: mergeCookie.nonce });

		if (nonceError) {
			console.error('[account-merge] Failed to record nonce:', nonceError);
			throw httpError(500, 'Failed to validate merge request');
		}

		// Call the merge function
		const { data: mergeResult, error: mergeError } = await supabaseAdmin.rpc('merge_accounts', {
			p_primary_user_id: primaryUserId,
			p_secondary_user_id: secondaryUserId
		});

		if (mergeError) {
			console.error('[account-merge] Merge function failed:', mergeError);
			// Clean up nonce on failure
			await supabaseAdmin.from('merge_nonces').delete().eq('nonce', mergeCookie.nonce);
			throw httpError(500, 'Account merge failed. Please try again.');
		}

		let deleteWarning: string | null = null;

		// Delete the secondary auth user
		const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(secondaryUserId);

		if (deleteError) {
			console.error('[account-merge] Failed to delete secondary auth user:', deleteError);
			
			// Try to ban the user instead
			const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(
				secondaryUserId,
				{ ban_duration: '876000h' } // 100 years
			);

			if (banError) {
				console.error('[account-merge] Failed to ban secondary user:', banError);
				deleteWarning = 'Warning: Secondary account could not be fully removed. Please contact support.';
			} else {
				deleteWarning = 'Warning: Secondary account was disabled but not deleted. It cannot be used to sign in.';
			}
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
			warning: deleteWarning,
			message: deleteWarning 
				? 'Accounts merged with warnings. Please sign in to your primary account.' 
				: 'Accounts merged successfully. Please sign in to your primary account.'
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
