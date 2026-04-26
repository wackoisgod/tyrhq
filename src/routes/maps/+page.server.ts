import { getMaps } from '$lib/data/maps';

export function load() {
	return {
		maps: getMaps()
	};
}
