/**
 * POST /auth/unmerge/complete
 * Completes the undo after user has confirmed with re-authentication
 */

import { error as httpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	verifyUnmergeCookie,
	deleteUnmergeCookie,
	UNMERGE_COOKIE_NAME
} from '$lib/server/account-unmerge';

export const POST: RequestHandler = async ({ locals, cookies }) => {
	const { session, user } = await locals.safeGetSession();

	if (!session || !user) {
		throw httpError(401, 'Not authenticated');
	}

	// Get and verify unmerge cookie
	const unmergeCookieValue = cookies.get(UNMERGE_COOKIE_NAME);
	const unmergeCookie = verifyUnmergeCookie(unmergeCookieValue);

	if (!unmergeCookie) {
		throw httpError(400, 'Invalid or expired unmerge session');
	}

	// Verify user is the primary user
	if (unmergeCookie.primaryUserId !== user.id) {
		throw httpError(400, 'Session mismatch. Please restart the undo process.');
	}

	// Verify recent authentication (session must be fresh)
	// Cookie issued at init must be within 10 minutes, proving recent active use
	// This is sufficient since user must navigate through confirm page
	// (Secondary user is banned and cannot re-authenticate, so this MUST be primary)
	const timeSinceInit = Date.now() - unmergeCookie.issuedAt;
	if (timeSinceInit > 10 * 60 * 1000) { // 10 minutes
		throw httpError(400, 'Session expired. Please restart the undo process.');
	}

	const mergeId = unmergeCookie.mergeId;

	// Get admin client
	const { getSupabaseAdminClient } = await import('$lib/server/supabase-admin');
	const supabaseAdmin = getSupabaseAdminClient();

	if (!supabaseAdmin) {
		throw httpError(500, 'Admin client not configured');
	}

	// Verify merge exists and belongs to this user
	const { data: merge, error: fetchError } = await supabaseAdmin
		.from('account_merges')
		.select('*')
		.eq('id', mergeId)
		.eq('primary_user_id', user.id)
		.single();

	if (fetchError || !merge) {
		throw httpError(404, 'Merge not found or not authorized');
	}

	if (merge.status === 'undone') {
		throw httpError(400, 'This merge has already been undone');
	}

	// Mark nonce as used
	try {
		const { error: nonceError } = await supabaseAdmin
			.from('merge_nonces')
			.insert({ nonce: unmergeCookie.nonce });

		if (nonceError) {
			if (nonceError.code === '23505' || nonceError.message?.includes('duplicate key')) {
				const { value, options } = deleteUnmergeCookie();
				cookies.set(UNMERGE_COOKIE_NAME, value, options);
				throw httpError(400, 'This undo request has already been used.');
			}
			console.error('[unmerge] Failed to record nonce:', nonceError);
			throw httpError(500, 'Failed to validate undo request');
		}
	} catch (err: any) {
		if (err.status) {
			throw err;
		}
		throw httpError(500, 'Failed to validate undo request');
	}

	// Step 1: Call unmerge function to restore data FIRST
	// If this fails, we haven't unbanned anyone yet (clean state)
	try {
		const { data: result, error: unmergeError } = await supabaseAdmin.rpc('unmerge_accounts', {
			p_merge_id: mergeId
		});

		if (unmergeError) {
			console.error('[unmerge] Failed to undo merge in DB:', unmergeError);
			// Clean up nonce
			await supabaseAdmin.from('merge_nonces').delete().eq('nonce', unmergeCookie.nonce);
			throw httpError(500, 'Failed to undo merge data. No changes made to auth status.');
		}

		console.log('[unmerge] Database undo completed successfully');

		// Step 2: Unban secondary user AFTER successful data restore
		const { error: unbanError } = await supabaseAdmin.auth.admin.updateUserById(
			merge.secondary_user_id,
			{ ban_duration: 'none' }
		);

		if (unbanError) {
			console.error('[unmerge] CRITICAL: Data restored but failed to unban secondary user:', unbanError);
			// Data is restored but user still banned - this is recoverable via retry
			// Clean up nonce and cookie
			await supabaseAdmin.from('merge_nonces').delete().eq('nonce', unmergeCookie.nonce);
			const { value, options } = deleteUnmergeCookie();
			cookies.set(UNMERGE_COOKIE_NAME, value, options);
			
			throw httpError(500, 'Data restored successfully, but failed to restore sign-in access. Contact support to unban the secondary account.');
		}

		console.log('[unmerge] Secondary auth user unbanned successfully');

		// Delete the unmerge cookie
		const { value, options } = deleteUnmergeCookie();
		cookies.set(UNMERGE_COOKIE_NAME, value, options);
		
		return json({
			success: true,
			mergeId,
			result,
			message: 'Merge undone successfully. Secondary account has been fully restored and can be used to sign in.',
			authRestored: true,
			dataRestored: true
		});
	} catch (err: any) {
		console.error('[unmerge] Unexpected error during undo:', err);

		// Clean up cookie
		const { value, options } = deleteUnmergeCookie();
		cookies.set(UNMERGE_COOKIE_NAME, value, options);

		if (err.status) {
			throw err;
		}

		throw httpError(500, 'Unexpected error during undo');
	}
};
