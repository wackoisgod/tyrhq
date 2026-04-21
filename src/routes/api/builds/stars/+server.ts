import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseJsonBody, toggleBuildStarBodySchema } from '$lib/server/build-requests';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return error(401, 'Authentication required');

	const { buildId } = await parseJsonBody(request, toggleBuildStarBodySchema);

	// Check if user already starred this build
	const { data: existing } = await locals.supabase
		.from('build_stars')
		.select('user_id')
		.eq('user_id', user.id)
		.eq('build_id', buildId)
		.maybeSingle();

	if (existing) {
		// Unstar
		const { error: delError } = await locals.supabase
			.from('build_stars')
			.delete()
			.eq('user_id', user.id)
			.eq('build_id', buildId);

		if (delError) return error(500, delError.message);
	} else {
		// Star — RLS enforces: public build, not own build
		const { error: insError } = await locals.supabase
			.from('build_stars')
			.insert({ user_id: user.id, build_id: buildId });

		if (insError) return error(403, insError.message);
	}

	// Read back the current star_count
	const { data: build } = await locals.supabase
		.from('builds')
		.select('star_count')
		.eq('id', buildId)
		.single();

	return json({
		starred: !existing,
		starCount: build?.star_count ?? 0
	});
};
