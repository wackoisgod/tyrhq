import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { setUserRole, UserAdminError, type ProfileRole } from '$lib/server/users';
import { parseJsonBody } from '$lib/server/submission-requests';

const roleBodySchema = z
	.object({
		role: z.enum(['user', 'contributor', 'admin'])
	})
	.strict();

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');
	if (role !== 'admin') error(403, 'Admin role required');

	const body = await parseJsonBody(request, roleBodySchema);

	try {
		const updated = await setUserRole(params.id!, body.role as ProfileRole, {
			id: user.id,
			role
		});
		return json(updated);
	} catch (err) {
		if (err instanceof UserAdminError) error(err.statusCode, err.message);
		throw err;
	}
};
