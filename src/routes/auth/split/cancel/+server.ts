/**
 * POST /auth/split/cancel
 * Cancels an in-progress split operation by deleting the split cookie
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteSplitCookie, SPLIT_COOKIE_NAME } from '$lib/server/account-split';

export const POST: RequestHandler = async ({ cookies }) => {
	const { value, options } = deleteSplitCookie();
	cookies.set(SPLIT_COOKIE_NAME, value, options);

	return json({
		success: true,
		message: 'Split operation cancelled'
	});
};
