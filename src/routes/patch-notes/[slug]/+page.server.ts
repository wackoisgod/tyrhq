import { error } from '@sveltejs/kit';
import { getPublishedArticle } from '$lib/server/articles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders, locals }) => {
	setHeaders({
		'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600'
	});

	const patch = await getPublishedArticle('patch', params.slug);
	if (!patch) throw error(404, 'Patch notes not found');

	const { user } = await locals.safeGetSession();
	let userHasStarred = false;

	if (user && locals.supabase && patch.authorUserId !== user.id) {
		const { data: starRow } = await locals.supabase
			.from('article_stars')
			.select('user_id')
			.eq('user_id', user.id)
			.eq('article_id', patch.id)
			.maybeSingle();

		userHasStarred = !!starRow;
	}

	return { patch, userHasStarred };
};
