import { getCompareTanks } from '$lib/data/game-data';
import { hasVehicleArmorAssets } from '$lib/server/game-assets';

export function load() {
	return {
		tanks: getCompareTanks().map((tank) => ({
			...tank,
			modelAvailable: hasVehicleArmorAssets(tank.id)
		}))
	};
}
