import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteSubmission } from '$lib/server/submissions';
import { rethrowAsHttp } from '$lib/server/submission-requests';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');

	try {
		await deleteSubmission(params.id!, { id: user.id, role });
		return json({ ok: true });
	} catch (err) {
		rethrowAsHttp(err);
	}
};
