import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { removeEvent, updateEvent } from '$lib/server/events';
import {
	eventCreateBodySchema,
	parseJsonBody,
	rethrowAsHttp
} from '$lib/server/event-requests';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');

	const body = await parseJsonBody(request, eventCreateBodySchema);

	try {
		const event = await updateEvent(
			params.id!,
			{
				title: body.title,
				description: body.description ?? null,
				location: body.location ?? null,
				url: body.url ?? null,
				startsAt: body.startsAt,
				endsAt: body.endsAt ?? null
			},
			{ id: user.id, role }
		);
		return json(event);
	} catch (err) {
		rethrowAsHttp(err);
	}
};

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
