import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLink } from '$lib/server/community-links';
import {
	linkCreateBodySchema,
	parseJsonBody,
	rethrowAsHttp
} from '$lib/server/community-link-requests';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');
	if (role !== 'admin') error(403, 'Admin role required');

	const body = await parseJsonBody(request, linkCreateBodySchema);

	try {
		const link = await createLink(
			body.groupId,
			{
				label: body.label,
				href: body.href,
				description: body.description ?? null,
				tag: body.tag ?? null
			},
			{ role }
		);
		return json(link, { status: 201 });
	} catch (err) {
		rethrowAsHttp(err);
	}
};
