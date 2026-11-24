/**
 * POST /auth/unmerge/init
 * Initiates undo of a merge (requires re-authentication)
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createUnmergeCookie, getUnmergeSecret, UNMERGE_COOKIE_NAME } from '$lib/server/account-unmerge';

export const POST: RequestHandler = async ({ locals, cookies, request }) => {
	const { session, user } = await locals.safeGetSession();

	if (!session || !user) {
		throw error(401, 'Not authenticated');
	}

	// Verify MERGE_SECRET is configured
	try {
		getUnmergeSecret();
	} catch (err: any) {
		console.error('[unmerge] MERGE_SECRET not configured:', err);
		throw error(500, 'Account unmerge is not configured. Please contact support.');
	}

	const body = await request.json();
	const mergeId = body.mergeId as string;

	if (!mergeId) {
		throw error(400, 'Missing merge ID');
	}

	// Get admin client to verify merge exists and belongs to this user
	const { getSupabaseAdminClient } = await import('$lib/server/supabase-admin');
	const supabaseAdmin = getSupabaseAdminClient();

	if (!supabaseAdmin) {
		throw error(500, 'Admin client not configured');
	}

	// Verify merge exists and belongs to this user
	const { data: merge, error: fetchError } = await supabaseAdmin
		.from('account_merges')
		.select('*')
		.eq('id', mergeId)
		.eq('primary_user_id', user.id)
		.single();

	if (fetchError || !merge) {
		throw error(404, 'Merge not found or not authorized');
	}

	if (merge.status === 'undone') {
		throw error(400, 'This merge has already been undone');
	}

	// Create unmerge cookie
	const { value, options } = createUnmergeCookie(user.id, mergeId);
	cookies.set(UNMERGE_COOKIE_NAME, value, options);

	return json({
		success: true,
		primaryUserId: user.id,
		mergeId,
		expiresIn: options.maxAge
	});
};
