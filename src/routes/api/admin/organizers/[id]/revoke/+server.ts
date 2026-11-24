import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { OrganizerApplicationError, revokeOrganizerAccess } from '$lib/server/organizer-applications';
import { UserAdminError } from '$lib/server/users';

export const POST: RequestHandler = async ({ params, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');
	if (role !== 'admin') error(403, 'Admin role required');

	try {
		const updated = await revokeOrganizerAccess(params.id!, { role });
		return json(updated);
	} catch (err) {
		if (err instanceof OrganizerApplicationError) error(err.statusCode, err.message);
		if (err instanceof UserAdminError) error(err.statusCode, err.message);
		throw err;
	}
};
