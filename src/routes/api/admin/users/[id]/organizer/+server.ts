import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { setTournamentOrganizer, UserAdminError } from '$lib/server/users';
import { parseJsonBody } from '$lib/server/submission-requests';

const organizerBodySchema = z
	.object({
		enabled: z.boolean()
	})
	.strict();

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');
	if (role !== 'admin' && role !== 'contributor') error(403, 'Reviewer or admin role required');

	const body = await parseJsonBody(request, organizerBodySchema);

	try {
		const updated = await setTournamentOrganizer(params.id!, body.enabled, { role });
		return json(updated);
	} catch (err) {
		if (err instanceof UserAdminError) error(err.statusCode, err.message);
		throw err;
	}
};
