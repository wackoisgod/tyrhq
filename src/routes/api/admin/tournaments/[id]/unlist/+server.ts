import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { OrganizerApplicationError, unlistTournament } from '$lib/server/organizer-applications';
import { parseJsonBody } from '$lib/server/submission-requests';

const unlistSchema = z
	.object({
		note: z.string().max(500).nullable().optional()
	})
	.strict();

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');
	if (role !== 'admin') error(403, 'Admin role required');

	const body = await parseJsonBody(request, unlistSchema);
	try {
		const tournament = await unlistTournament(params.id!, { id: user.id, role }, body.note ?? null);
		return json(tournament);
	} catch (err) {
		if (err instanceof OrganizerApplicationError) error(err.statusCode, err.message);
		throw err;
	}
};
