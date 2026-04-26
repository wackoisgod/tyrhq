import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sanitizeArticleBody } from '$lib/server/content-sanitize';
import { parseJsonBody, previewBodySchema, rethrowAsHttp } from '$lib/server/submission-requests';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');

	const body = await parseJsonBody(request, previewBodySchema);

	try {
		const result = await sanitizeArticleBody(body.bodyMarkdown);
		return json({ html: result.html, wordCount: result.wordCount });
	} catch (err) {
		rethrowAsHttp(err);
	}
};
