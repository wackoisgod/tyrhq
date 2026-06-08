import { error } from '@sveltejs/kit';
import { getPublishedArticle, getWithdrawnArticle } from '$lib/server/articles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	setHeaders({
		'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600'
	});
	const post = await getPublishedArticle('article', params.slug);
	if (!post) {
		const withdrawn = await getWithdrawnArticle('article', params.slug);
		if (withdrawn) {
			throw error(410, {
				message: 'This article has been withdrawn',
				withdrawn: true,
				title: withdrawn.title,
				backHref: '/articles',
				backLabel: 'Back to Articles'
			});
		}
		throw error(404, 'Post not found');
	}
	return { post };
};
