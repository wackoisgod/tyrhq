import type { PageServerLoad } from './$types';
import { listEventsForUser, listPastEvents, listUpcomingEvents } from '$lib/server/events';
import { isSupabaseAdminConfigured } from '$lib/server/supabase-admin';

export const load: PageServerLoad = async ({ locals }) => {
	const { user, role } = await locals.safeGetSession();

	const [upcoming, past, mine] = await Promise.all([
		listUpcomingEvents(),
		listPastEvents(),
		user ? listEventsForUser(user.id) : Promise.resolve([])
	]);

	return {
		upcoming,
		past,
		mine,
		role,
		signedIn: Boolean(user),
		currentUserId: user?.id ?? null,
		eventsEnabled: isSupabaseAdminConfigured()
	};
};
