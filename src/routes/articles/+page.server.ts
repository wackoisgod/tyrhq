import { listPublishedArticles } from '$lib/server/articles';

export async function load({ setHeaders }) {
	setHeaders({
		'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600'
	});
	const posts = await listPublishedArticles('article');
	return { posts };
}
