import { error } from '@sveltejs/kit';
import { loadAllGuides } from '$lib/server/content';
import { getGameSnapshot } from '$lib/data/game-data';
import type { PageServerLoad } from './$types';

const guideMeta = import.meta.glob('/src/content/guides/*.md', {
	eager: true,
	import: 'metadata'
});

export const load: PageServerLoad = ({ params }) => {
	const guides = loadAllGuides(guideMeta as Parameters<typeof loadAllGuides>[0]);
	const guide = guides.find((g) => g.slug === params.slug);

	if (!guide) throw error(404, 'Guide not found');

	const tankBySlug = new Map(getGameSnapshot().tanks.map((t) => [t.slug, t]));
	const vehicles = (guide.vehicleSlugs ?? [])
		.map((slug) => tankBySlug.get(slug))
		.filter((t): t is NonNullable<typeof t> => Boolean(t))
		.map((t) => ({ slug: t.slug, name: t.name, classLabel: t.classLabel }));

	return { guide, vehicles };
};
