import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchUsers, UserAdminError } from '$lib/server/users';

export const GET: RequestHandler = async ({ url, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');
	if (role !== 'admin' && role !== 'contributor') error(403, 'Reviewer or admin role required');

	const q = url.searchParams.get('q') ?? '';

	try {
		const users = await searchUsers(q);
		return json({ users });
	} catch (err) {
		if (err instanceof UserAdminError) error(err.statusCode, err.message);
		throw err;
	}
};
