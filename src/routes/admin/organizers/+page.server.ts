import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	listOrganizerProfiles,
	listPendingOrganizerApplications,
	listTournamentsForModeration,
	OrganizerApplicationError
} from '$lib/server/organizer-applications';

export const load: PageServerLoad = async ({ locals, url }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) {
		throw redirect(303, `/auth?next=${encodeURIComponent(url.pathname)}`);
	}
	if (role !== 'admin') throw error(403, 'Admin role required');

	try {
		const [applications, organizers, tournaments] = await Promise.all([
			listPendingOrganizerApplications(),
			listOrganizerProfiles(),
			listTournamentsForModeration()
		]);
		return { applications, organizers, tournaments };
	} catch (err) {
		if (err instanceof OrganizerApplicationError) error(err.statusCode, err.message);
		throw err;
	}
};
