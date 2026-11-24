import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { OrganizerApplicationError, reviewOrganizerApplication } from '$lib/server/organizer-applications';
import { parseJsonBody } from '$lib/server/submission-requests';

const decisionSchema = z
	.object({
		decision: z.enum(['approve', 'reject']),
		note: z.string().max(2000).nullable().optional()
	})
	.strict();

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');
	if (role !== 'admin') error(403, 'Admin role required');

	const body = await parseJsonBody(request, decisionSchema);
	try {
		const application = await reviewOrganizerApplication(
			params.id!,
			{ id: user.id, role },
			{ decision: body.decision, note: body.note ?? null }
		);
		return json(application);
	} catch (err) {
		if (err instanceof OrganizerApplicationError) error(err.statusCode, err.message);
		throw err;
	}
};
