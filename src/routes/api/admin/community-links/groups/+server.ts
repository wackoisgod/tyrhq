import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createGroup } from '$lib/server/community-links';
import {
	groupBodySchema,
	parseJsonBody,
	rethrowAsHttp
} from '$lib/server/community-link-requests';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');
	if (role !== 'admin') error(403, 'Admin role required');

	const body = await parseJsonBody(request, groupBodySchema);

	try {
		const group = await createGroup(
			{ heading: body.heading, annotation: body.annotation ?? null },
			{ role }
		);
		return json(group, { status: 201 });
	} catch (err) {
		rethrowAsHttp(err);
	}
};
