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
		let splitResult: any = {};

		// Unified unlinkIdentity flow for all providers
		if (!splitCookie.identityId) {
			throw httpError(400, `Missing identity ID for ${splitCookie.provider} split`);
		}

		// Find and unlink the identity
		const providerMap: Record<string, string> = {
			google: 'google',
			email: 'email',
			steam: 'custom:steam'
		};

		const providerKey = providerMap[splitCookie.provider];
		if (!providerKey) {
			throw httpError(400, `Unsupported provider: ${splitCookie.provider}`);
		}

		const identity = user.identities?.find((i) => i.provider === providerKey);
		if (!identity) {
			throw httpError(400, `${splitCookie.provider} identity not found`);
		}

		const { error: unlinkError } = await locals.supabase.auth.unlinkIdentity(identity);

		if (unlinkError) {
			console.error(`[account-split] Failed to unlink ${splitCookie.provider}:`, unlinkError);
			throw httpError(500, `Failed to unlink ${splitCookie.provider} identity. Please try again.`);
		}

		splitResult = {
			provider: splitCookie.provider,
			action: 'unlinked',
			note: `Sign in with ${splitCookie.provider} to create your new account`
		};

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
