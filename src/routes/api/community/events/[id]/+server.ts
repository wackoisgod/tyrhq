import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { removeEvent } from '$lib/server/events';
import { rethrowAsHttp } from '$lib/server/event-requests';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');

	try {
		await removeEvent(params.id!, { id: user.id, role });
		return new Response(null, { status: 204 });
	} catch (err) {
		rethrowAsHttp(err);
	}
};
