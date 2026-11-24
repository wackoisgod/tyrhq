/**
 * POST /auth/merge/cancel
 * Cancels an in-progress account merge
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteMergeCookie, MERGE_COOKIE_NAME } from '$lib/server/account-merge';

export const POST: RequestHandler = async ({ cookies }) => {
	// Delete the merge cookie
	const { value, options } = deleteMergeCookie();
	cookies.set(MERGE_COOKIE_NAME, value, options);

	return json({
		success: true,
		message: 'Merge cancelled'
	});
};
