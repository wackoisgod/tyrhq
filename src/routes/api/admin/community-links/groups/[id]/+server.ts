import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { removeGroup, updateGroup } from '$lib/server/community-links';
import {
	groupBodySchema,
	parseJsonBody,
	rethrowAsHttp
} from '$lib/server/community-link-requests';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');
	if (role !== 'admin') error(403, 'Admin role required');

	const body = await parseJsonBody(request, groupBodySchema);

	try {
		const group = await updateGroup(
			params.id!,
			{ heading: body.heading, annotation: body.annotation ?? null },
			{ role }
		);
		return json(group);
	} catch (err) {
		rethrowAsHttp(err);
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');
	if (role !== 'admin') error(403, 'Admin role required');

	try {
		await removeGroup(params.id!, { role });
		return new Response(null, { status: 204 });
	} catch (err) {
		rethrowAsHttp(err);
	}
};
