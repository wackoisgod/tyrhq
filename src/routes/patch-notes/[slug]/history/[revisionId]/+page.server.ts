import { loadRevisionDiffPage } from '$lib/server/article-history-loader';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	setHeaders({
		'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600'
	});
	return loadRevisionDiffPage('patch', params.slug, params.revisionId);
};
