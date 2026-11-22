/**
 * POST /auth/merge/init
 * Initiates an account merge by setting a secure merge cookie
 * User must then re-authenticate as the secondary account
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createMergeCookie, MERGE_COOKIE_NAME } from '$lib/server/account-merge';

export const POST: RequestHandler = async ({ locals, cookies }) => {
	const { session, user } = await locals.safeGetSession();

	if (!session || !user) {
		throw error(401, 'Not authenticated');
	}

	// Create merge cookie with current user as primary
	const { value, options } = createMergeCookie(user.id);

	// Set the cookie
	cookies.set(MERGE_COOKIE_NAME, value, options);

	return json({
		success: true,
		primaryUserId: user.id,
		expiresIn: options.maxAge
	});
};
