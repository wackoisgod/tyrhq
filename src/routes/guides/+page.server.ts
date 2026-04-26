import { loadAllGuides } from '$lib/server/content';
import { getGameSnapshot } from '$lib/data/game-data';

const guideMeta = import.meta.glob('/src/content/guides/*.md', {
	eager: true,
	import: 'metadata'
});

export function load() {
	const guides = loadAllGuides(guideMeta as Parameters<typeof loadAllGuides>[0]).filter(
		(g) => !g.draft
	);

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
