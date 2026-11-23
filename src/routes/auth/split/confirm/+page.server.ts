/**
 * Confirmation page for splitting a sign-in method
 * Shows which method will be split and requires re-authentication
 */

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	verifySplitCookie,
	createSplitCookie,
	SPLIT_COOKIE_NAME,
	deleteSplitCookie
} from '$lib/server/account-split';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const { session, user } = await locals.safeGetSession();

	if (!session || !user) {
		redirect(303, '/auth');
	}

	// Verify split cookie exists and is in initiated phase
	const splitCookie = verifySplitCookie(cookies.get(SPLIT_COOKIE_NAME));

	if (!splitCookie || splitCookie.phase !== 'initiated') {
		redirect(303, '/settings?error=split_expired');
	}

	// User just re-authenticated with the same account
	if (splitCookie.currentUserId === user.id) {
		// This is the current user, not re-auth yet
		// Show the confirmation page
		return {
			provider: splitCookie.provider,
			currentUserId: splitCookie.currentUserId
		};
	}

	// If user authenticated as different account, that's an error
	const { value, options } = deleteSplitCookie();
	cookies.set(SPLIT_COOKIE_NAME, value, options);
	redirect(303, '/settings?error=split_wrong_user');
};
