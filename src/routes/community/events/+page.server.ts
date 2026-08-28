import type { PageServerLoad } from './$types';
import { listPastEvents, listUpcomingEvents } from '$lib/server/events';
import { isSupabaseAdminConfigured } from '$lib/server/supabase-admin';

export const load: PageServerLoad = async ({ locals }) => {
	const { user, role } = await locals.safeGetSession();

	const [upcoming, past] = await Promise.all([listUpcomingEvents(), listPastEvents()]);

	return {
		upcoming,
		past,
		role,
		signedIn: Boolean(user),
		currentUserId: user?.id ?? null,
		eventsEnabled: isSupabaseAdminConfigured()
	};
};
