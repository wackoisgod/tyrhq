/**
 * POST /auth/split/complete
 * Completes the split after user has re-authenticated with the target method
 * Creates new account, moves the identity, updates current account
 */

import { error as httpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	verifySplitCookie,
	deleteSplitCookie,
	SPLIT_COOKIE_NAME
} from '$lib/server/account-split';
import { getSplitSecret } from '$lib/server/account-split';

export const POST: RequestHandler = async ({ locals, cookies }) => {
	const { session, user } = await locals.safeGetSession();

	if (!session || !user) {
		throw httpError(401, 'Not authenticated');
	}

	// Verify MERGE_SECRET is configured
	try {
		getSplitSecret();
	} catch (err: any) {
		console.error('[account-split] MERGE_SECRET not configured:', err);
		throw httpError(500, 'Account split is not configured. Please contact support.');
	}

	// Get and verify split cookie
	const splitCookieValue = cookies.get(SPLIT_COOKIE_NAME);
	const splitCookie = verifySplitCookie(splitCookieValue);

	if (!splitCookie) {
		throw httpError(400, 'Invalid or expired split session');
	}

	// Verify user is the original user (not re-authed yet with different provider)
	if (splitCookie.currentUserId !== user.id) {
		throw httpError(400, 'Session mismatch. Please restart the split process.');
	}

	// Get admin client
	const { getSupabaseAdminClient } = await import('$lib/server/supabase-admin');
	const supabaseAdmin = getSupabaseAdminClient();

	if (!supabaseAdmin) {
		throw httpError(500, 'Admin client not configured');
	}

	try {
		let newUserId: string;
		let splitResult: any = {};

		if (splitCookie.provider === 'google') {
			// For Google: unlink from current, user signs in fresh (creates new account)
			if (!splitCookie.identityId) {
				throw httpError(400, 'Missing identity ID for Google split');
			}

			// Unlink Google identity from current user
			const googleIdentity = user.identities?.find((i) => i.provider === 'google');
			if (!googleIdentity) {
				throw httpError(400, 'Google identity not found');
			}

			const { error: unlinkError } = await locals.supabase.auth.unlinkIdentity(googleIdentity);

			if (unlinkError) {
				console.error('[account-split] Failed to unlink Google:', unlinkError);
				throw httpError(500, 'Failed to unlink Google identity. Please try again.');
			}

			splitResult = {
				provider: 'google',
				action: 'unlinked',
				note: 'Sign in with Google to create your new account'
			};

		} else if (splitCookie.provider === 'email') {
			// For email+password: unlink email identity
			// User will need to sign up fresh with their email
			if (!splitCookie.identityId) {
				throw httpError(400, 'Missing identity ID for email split');
			}

			const emailIdentity = user.identities?.find((i) => i.provider === 'email');
			if (!emailIdentity) {
				throw httpError(400, 'Email identity not found');
			}

			const { error: unlinkError } = await locals.supabase.auth.unlinkIdentity(emailIdentity);

			if (unlinkError) {
				console.error('[account-split] Failed to unlink email:', unlinkError);
				throw httpError(500, 'Failed to unlink email identity. Please try again.');
			}

			splitResult = {
				provider: 'email',
				action: 'unlinked',
				note: 'Sign up with your email to create your new account'
			};

		} else if (splitCookie.provider === 'steam') {
			// For Steam: clear verified_steam_id from current profile
			// User will need to verify Steam on new account
			if (!splitCookie.steamId) {
				throw httpError(400, 'Missing Steam ID for split');
			}

			// Use admin client to clear Steam verification
			const { error: clearError } = await supabaseAdmin
				.from('profiles')
				.update({
					verified_steam_id: null,
					steam_display_name: null,
					steam_verified_at: null
				})
				.eq('id', user.id);

			if (clearError) {
				console.error('[account-split] Failed to clear Steam:', clearError);
				throw httpError(500, 'Failed to remove Steam verification. Please try again.');
			}

			splitResult = {
				provider: 'steam',
				steamId: splitCookie.steamId,
				action: 'cleared',
				note: 'Steam verification removed. Sign in with Steam to create your new account.'
			};
		}

		// Delete the split cookie
		const { value, options } = deleteSplitCookie();
		cookies.set(SPLIT_COOKIE_NAME, value, options);

		// Sign out current session so user can sign in fresh
		await locals.supabase.auth.signOut();

		return json({
			success: true,
			currentUserId: user.id,
			splitResult,
			message: `${splitCookie.provider} sign-in method split successfully. Please sign in with ${splitCookie.provider} to access your new account.`
		});
	} catch (err: any) {
		console.error('[account-split] Unexpected error:', err);

		// Clean up cookie on error
		const { value, options } = deleteSplitCookie();
		cookies.set(SPLIT_COOKIE_NAME, value, options);

		if (err.status) {
			throw err;
		}

		throw httpError(500, 'Unexpected error during split');
	}
};
