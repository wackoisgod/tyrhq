import { error } from '@sveltejs/kit';
import { getPublishedArticle } from '$lib/server/articles';
import { listArticleContributors } from '$lib/server/article-revisions';
import { getGameSnapshot } from '$lib/data/game-data';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders, locals }) => {
	setHeaders({
		'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600'
	});

	const guide = await getPublishedArticle('guide', params.slug);
	if (!guide) throw error(404, 'Guide not found');

	const { user } = await locals.safeGetSession();
	let userHasStarred = false;

	if (user && locals.supabase && guide.authorUserId !== user.id) {
		const { data: starRow } = await locals.supabase
			.from('article_stars')
			.select('user_id')
			.eq('user_id', user.id)
			.eq('article_id', guide.id)
			.maybeSingle();

		userHasStarred = !!starRow;
	}

	const tankBySlug = new Map(getGameSnapshot().tanks.map((t) => [t.slug, t]));
	const vehicles = (guide.vehicleSlugs ?? [])
		.map((slug) => tankBySlug.get(slug))
		.filter((t): t is NonNullable<typeof t> => Boolean(t))
		.map((t) => ({ slug: t.slug, name: t.name, classLabel: t.classLabel }));

	const contributors = await listArticleContributors(guide.id);

	return { guide, vehicles, userHasStarred, contributors };
};
