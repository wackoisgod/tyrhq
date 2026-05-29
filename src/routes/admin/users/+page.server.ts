import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listElevatedUsers, UserAdminError } from '$lib/server/users';

export const load: PageServerLoad = async ({ locals, url }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) {
		throw redirect(303, `/auth?next=${encodeURIComponent(url.pathname)}`);
	}
	if (role !== 'admin' && role !== 'contributor') {
		throw error(403, 'Reviewer or admin role required');
	}

	try {
		const elevated = await listElevatedUsers();
		return { elevated, currentUserId: user.id, role };
	} catch (err) {
		if (err instanceof UserAdminError) error(err.statusCode, err.message);
		throw err;
	}
};
