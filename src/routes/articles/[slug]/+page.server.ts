import { error } from '@sveltejs/kit';
import { getPublishedArticle } from '$lib/server/articles';
import { listArticleContributors } from '$lib/server/article-revisions';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	setHeaders({
		'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600'
	});
	const post = await getPublishedArticle('article', params.slug);
	if (!post) throw error(404, 'Post not found');
	const contributors = await listArticleContributors(post.id);
	return { post, contributors };
};
