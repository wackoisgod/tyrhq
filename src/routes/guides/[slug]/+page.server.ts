import { error } from '@sveltejs/kit';
import { getPublishedArticle } from '$lib/server/articles';
import { getGameSnapshot } from '$lib/data/game-data';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	setHeaders({
		'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600'
	});

	const guide = await getPublishedArticle('guide', params.slug);
	if (!guide) throw error(404, 'Guide not found');

	const tankBySlug = new Map(getGameSnapshot().tanks.map((t) => [t.slug, t]));
	const vehicles = (guide.vehicleSlugs ?? [])
		.map((slug) => tankBySlug.get(slug))
		.filter((t): t is NonNullable<typeof t> => Boolean(t))
		.map((t) => ({ slug: t.slug, name: t.name, classLabel: t.classLabel }));

	return { guide, vehicles };
};
