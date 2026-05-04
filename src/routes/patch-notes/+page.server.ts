import { listPublishedArticles } from '$lib/server/articles';
import { compareVersionsDesc } from '$lib/utils/version';

export async function load({ setHeaders }) {
	setHeaders({
		'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600'
	});

	const patches = await listPublishedArticles('patch');
	// Sort by version desc so back-published older versions don't outrank
	// newer ones just because they were uploaded later. Date is the tiebreaker
	// for rows with the same (or missing) version.
	patches.sort((a, b) => {
		const cmp = compareVersionsDesc(a.version, b.version);
		if (cmp !== 0) return cmp;
		return b.publishedAt.localeCompare(a.publishedAt);
	});
	return { patches };
}
