import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPublishedArticles } from '$lib/server/articles';

/**
 * Published guides as link targets for the editor's guide picker. Titles and
 * slugs only — signed-in users linking a guide from build notes or an article
 * draft don't need the full summaries payload.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return error(401, 'Authentication required');

	const guides = await listPublishedArticles('guide');
	return json(
		guides.map((guide) => ({
			slug: guide.slug,
			title: guide.title,
			vehicleSlugs: guide.vehicleSlugs ?? []
		}))
	);
};
