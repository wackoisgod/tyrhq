import { getGameSnapshot } from '$lib/data/game-data';

export function load() {
	const snapshot = getGameSnapshot();

	return {
		tanks: snapshot.tanks
	};
}
