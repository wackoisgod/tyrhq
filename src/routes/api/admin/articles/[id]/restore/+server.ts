import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { restoreArticle } from '$lib/server/submissions';
import { rethrowAsHttp } from '$lib/server/submission-requests';

export const POST: RequestHandler = async ({ params, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');
	if (role !== 'contributor' && role !== 'admin') error(403, 'Reviewer role required');

	try {
		await restoreArticle(params.id!, { id: user.id, role });
		return json({ ok: true });
	} catch (err) {
		rethrowAsHttp(err);
	}
};
