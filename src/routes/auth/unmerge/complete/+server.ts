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

	// Step 1: Restore auth user FIRST (before DB changes)
	try {
		const { error: unbanError } = await supabaseAdmin.auth.admin.updateUserById(
			merge.secondary_user_id,
			{ ban_duration: 'none' }
		);

		if (unbanError) {
			console.error('[unmerge] Failed to unban secondary user:', unbanError);
			// Clean up nonce
			await supabaseAdmin.from('merge_nonces').delete().eq('nonce', unmergeCookie.nonce);
			throw httpError(500, 'Failed to restore secondary account access. Undo aborted.');
		}

		console.log('[unmerge] Secondary auth user unbanned successfully');
	} catch (err: any) {
		console.error('[unmerge] Auth restoration failed before DB changes:', err);
		if (err.status) {
			throw err;
		}
		throw httpError(500, 'Failed to restore auth access. Undo aborted before data changes.');
	}

	// Step 2: Call unmerge function to restore data
	try {
		const { data: result, error: unmergeError } = await supabaseAdmin.rpc('unmerge_accounts', {
			p_merge_id: mergeId
		});

		if (unmergeError) {
			console.error('[unmerge] Failed to undo merge in DB:', unmergeError);
			
			// Try to re-ban user since DB undo failed
			await supabaseAdmin.auth.admin.updateUserById(
				merge.secondary_user_id,
				{ ban_duration: '876000h' }
			).catch(banErr => {
				console.error('[unmerge] Failed to re-ban user after DB error:', banErr);
			});
			
			// Clean up nonce
			await supabaseAdmin.from('merge_nonces').delete().eq('nonce', unmergeCookie.nonce);
			
			throw httpError(500, 'Failed to undo merge data. Secondary account has been re-disabled.');
		}

		console.log('[unmerge] Database undo completed successfully');

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
		console.error('[unmerge] Unexpected error during DB undo:', err);

		// Clean up cookie
		const { value, options } = deleteUnmergeCookie();
		cookies.set(UNMERGE_COOKIE_NAME, value, options);

		if (err.status) {
			throw err;
		}

		throw httpError(500, 'Unexpected error during data restoration');
	}
};
