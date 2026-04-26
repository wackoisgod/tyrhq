import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listSubmissionsForUser } from '$lib/server/submissions';

export const load: PageServerLoad = async ({ locals, url }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		throw redirect(303, `/auth?next=${encodeURIComponent(url.pathname)}`);
	}

	const submissions = await listSubmissionsForUser(user.id);
	return { submissions };
};
