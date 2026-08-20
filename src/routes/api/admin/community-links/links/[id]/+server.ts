import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { removeLink, updateLink } from '$lib/server/community-links';
import {
	linkUpdateBodySchema,
	parseJsonBody,
	rethrowAsHttp
} from '$lib/server/community-link-requests';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');
	if (role !== 'admin') error(403, 'Admin role required');

	const body = await parseJsonBody(request, linkUpdateBodySchema);

	try {
		const link = await updateLink(
			params.id!,
			{
				label: body.label,
				href: body.href,
				description: body.description ?? null,
				tag: body.tag ?? null
			},
			{ role }
		);
		return json(link);
	} catch (err) {
		rethrowAsHttp(err);
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');
	if (role !== 'admin') error(403, 'Admin role required');

	try {
		await removeLink(params.id!, { role });
		return new Response(null, { status: 204 });
	} catch (err) {
		rethrowAsHttp(err);
	}
};
