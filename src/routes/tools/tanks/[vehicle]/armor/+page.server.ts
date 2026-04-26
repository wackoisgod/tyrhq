import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getGameSnapshot } from '$lib/data/game-data';
import { hasVehicleArmorAssets } from '$lib/server/game-assets';

export const load: PageServerLoad = async ({ params }) => {
	const snapshot = getGameSnapshot();
	const slugOrId = params.vehicle;

	const tank = snapshot.tanks.find((entry) => entry.slug === slugOrId || entry.id === slugOrId);

	if (!tank) {
		throw error(404, 'Vehicle not found');
	}

	if (!hasVehicleArmorAssets(tank.id)) {
		throw error(404, 'Armor viewer not available for this vehicle yet');
	}

	return {
		tank,
		shooters: snapshot.tanks.filter((entry) => entry.selectable)
	};
};
