import { error } from '@sveltejs/kit';
import { getMaps, getMapBySlug } from '$lib/data/maps';
import { getGameSnapshot } from '$lib/data/game-data';

export function load({ params }) {
	const map = getMapBySlug(params.slug);
	if (!map) throw error(404, 'Map not found');

	const otherMaps = getMaps()
		.filter((m) => m.slug !== map.slug)
		.slice(0, 4);

	const tanks = getGameSnapshot()
		.tanks.filter((t) => t.selectable)
		.map((t) => ({ id: t.id, name: t.name, classId: t.classId, vision: t.stats.vision }));

	return { map, otherMaps, tanks };
}
