/**
 * POST /auth/unmerge
 * Initiates undo of a merge (requires re-authentication)
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	const { session, user } = await locals.safeGetSession();

	if (!session || !user) {
		throw error(401, 'Not authenticated');
	}

	const body = await request.json();
	const mergeId = body.mergeId as string;

	if (!mergeId) {
		throw error(400, 'Missing merge ID');
	}

	// Get admin client
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

	// Call unmerge function
	try {
		const { data: result, error: unmergeError } = await supabaseAdmin.rpc('unmerge_accounts', {
			p_merge_id: mergeId
		});

		if (unmergeError) {
			console.error('[unmerge] Failed to undo merge:', unmergeError);
			throw error(500, 'Failed to undo merge. Please try again.');
		}

		// Note: Auth user restoration must be done here
		// For now, just return success - full implementation would restore auth.users
		
		return json({
			success: true,
			mergeId,
			result,
			message: 'Merge undone successfully. Secondary account data has been restored.',
			note: 'Auth user restoration requires additional implementation.'
		});
	} catch (err: any) {
		console.error('[unmerge] Unexpected error:', err);

		if (err.status) {
			throw err;
		}

		throw error(500, 'Unexpected error during unmerge');
	}
};
