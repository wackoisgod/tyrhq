import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createEvent } from '$lib/server/events';
import {
	eventCreateBodySchema,
	parseJsonBody,
	rethrowAsHttp
} from '$lib/server/event-requests';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');

	const body = await parseJsonBody(request, eventCreateBodySchema);

	try {
		const event = await createEvent(
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
		return json(event, { status: 201 });
	} catch (err) {
		rethrowAsHttp(err);
	}
};
