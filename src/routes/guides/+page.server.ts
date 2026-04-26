import { listPublishedArticles } from '$lib/server/articles';
import { getGameSnapshot } from '$lib/data/game-data';

export async function load({ setHeaders }) {
	setHeaders({
		'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600'
	});

	const guides = await listPublishedArticles('guide');

	const general = guides.filter((g) => !g.vehicleSlugs?.length);

	const tanks = getGameSnapshot().tanks;
	const tankBySlug = new Map(tanks.map((t) => [t.slug, t]));

	const groupsBySlug = new Map<
		string,
		{
			slug: string;
			name: string;
			classLabel: string;
			classId: string;
			guides: typeof guides;
		}
	>();

	for (const guide of guides) {
		if (!guide.vehicleSlugs?.length) continue;
		for (const vehicleSlug of guide.vehicleSlugs) {
			const tank = tankBySlug.get(vehicleSlug);
			if (!tank) continue;
			let group = groupsBySlug.get(tank.slug);
			if (!group) {
				group = {
					slug: tank.slug,
					name: tank.name,
					classLabel: tank.classLabel,
					classId: tank.classId,
					guides: []
				};
				groupsBySlug.set(tank.slug, group);
			}
			group.guides.push(guide);
		}
	}

	const vehicleGroups = [...groupsBySlug.values()].sort((a, b) => a.name.localeCompare(b.name));

	return {
		general,
		vehicleGroups
	};
}
