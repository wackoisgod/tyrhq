import { getGameDataBundle } from '$lib/data/game-data';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const bundle = getGameDataBundle();
	const { user } = await locals.safeGetSession();
	const requestedVehicleId = url.searchParams.get('vehicle');
	const lockVehicle = url.searchParams.get('locked') === '1';
	const slug = url.searchParams.get('slug');
	const initialVehicleId =
		requestedVehicleId && bundle.vehicles.some((vehicle) => vehicle.id === requestedVehicleId)
			? requestedVehicleId
			: null;

	let loadedBuild: {
		id: string;
		slug: string;
		title: string;
		vehicle_id: string;
		selection: unknown;
		is_public: boolean;
		user_id: string;
		star_count: number;
	} | null = null;
	let creatorName: string | null = null;
	let userHasStarred = false;

	if (slug && locals.supabase) {
		// RLS allows access if user owns it OR it's public
		const { data } = await locals.supabase
			.from('builds')
			.select('id, slug, title, vehicle_id, selection, is_public, user_id, star_count, profiles(display_name)')
			.eq('slug', slug)
			.single();

		if (data) {
			loadedBuild = data;
			// Supabase returns the joined profile as an object (single row via FK)
			const profile = data.profiles as unknown as { display_name: string } | null;
			creatorName = profile?.display_name || null;

			// Check if the current user has starred this build
			if (user && data.is_public && data.user_id !== user.id) {
				const { data: starRow } = await locals.supabase
					.from('build_stars')
					.select('user_id')
					.eq('user_id', user.id)
					.eq('build_id', data.id)
					.maybeSingle();
				userHasStarred = !!starRow;
			}
		}
	}

	// Lock vehicle when loading a saved build or when explicitly locked via URL
	const lockedVehicleId = loadedBuild
		? loadedBuild.vehicle_id
		: lockVehicle
			? initialVehicleId
			: null;

	return {
		bundle,
		initialVehicleId: loadedBuild ? loadedBuild.vehicle_id : initialVehicleId,
		lockedVehicleId,
		loadedBuild,
		creatorName,
		userHasStarred
	};
};
