import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { parseJsonBody, toggleArticleStarBodySchema } from '$lib/server/article-requests';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return error(401, 'Authentication required');

	const { articleId } = await parseJsonBody(request, toggleArticleStarBodySchema);

	const { data: existing } = await locals.supabase
		.from('article_stars')
		.select('user_id')
		.eq('user_id', user.id)
		.eq('article_id', articleId)
		.maybeSingle();

	if (existing) {
		const { error: deleteError } = await locals.supabase
			.from('article_stars')
			.delete()
			.eq('user_id', user.id)
			.eq('article_id', articleId);

		if (deleteError) {
			console.error('[article-stars-api] Failed to remove star', deleteError);
			return error(500, 'Unable to update this guide star right now');
		}
	} else {
		const { error: insertError } = await locals.supabase
			.from('article_stars')
			.insert({ user_id: user.id, article_id: articleId });

		if (insertError) {
			console.error('[article-stars-api] Failed to add star', insertError);
			return error(403, 'Unable to star this guide');
		}
	}

	const { data: article } = await locals.supabase
		.from('articles')
		.select('star_count')
		.eq('id', articleId)
		.single();

	return json({
		starred: !existing,
		starCount: article?.star_count ?? 0
	});
};
