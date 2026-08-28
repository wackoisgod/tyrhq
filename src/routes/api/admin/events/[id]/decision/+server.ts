import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { decideEvent } from '$lib/server/events';
import {
	eventDecisionBodySchema,
	parseJsonBody,
	rethrowAsHttp
} from '$lib/server/event-requests';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');
	if (role !== 'contributor' && role !== 'admin') {
		error(403, 'Reviewer role required');
	}

	const body = await parseJsonBody(request, eventDecisionBodySchema);

	try {
		const event = await decideEvent(
			params.id!,
			{ id: user.id, role },
			{ decision: body.decision, notes: body.notes ?? null }
		);
		return json(event);
	} catch (err) {
		rethrowAsHttp(err);
	}
};
