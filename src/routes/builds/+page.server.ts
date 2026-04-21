import type { PageServerLoad } from './$types';
import { getGameDataBundle } from '$lib/data/game-data';

export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await locals.safeGetSession();
	const bundle = getGameDataBundle();

	if (!user) {
		return { builds: [], vehicles: bundle.vehicles, authenticated: false };
	}

	const { data: builds } = await locals.supabase
		.from('builds')
		.select('id, slug, title, vehicle_id, is_public, star_count, created_at, updated_at')
		.eq('user_id', user.id)
		.order('updated_at', { ascending: false });

	return {
		builds: builds ?? [],
		vehicles: bundle.vehicles,
		authenticated: true
	};
};
