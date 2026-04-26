import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSuggestedEditFromArticle } from '$lib/server/submissions';
import { rethrowAsHttp } from '$lib/server/submission-requests';

export const POST: RequestHandler = async ({ params, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');

	try {
		const submission = await createSuggestedEditFromArticle(params.id!, user.id);
		return json({ submissionId: submission.id });
	} catch (err) {
		rethrowAsHttp(err);
	}
};
