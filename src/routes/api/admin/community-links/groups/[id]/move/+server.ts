import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { moveGroup } from '$lib/server/community-links';
import { moveBodySchema, parseJsonBody, rethrowAsHttp } from '$lib/server/community-link-requests';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');
	if (role !== 'admin') error(403, 'Admin role required');

	const body = await parseJsonBody(request, moveBodySchema);

	try {
		await moveGroup(params.id!, body.direction, { role });
		return json({ ok: true });
	} catch (err) {
		rethrowAsHttp(err);
	}
};
