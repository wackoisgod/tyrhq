import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	CommunityEventError,
	getEventForActor,
	listEventsForUser,
	type CommunityEventRecord
} from '$lib/server/events';
import { isSupabaseAdminConfigured } from '$lib/server/supabase-admin';

export const load: PageServerLoad = async ({ locals, url }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) {
		throw redirect(303, `/auth?next=${encodeURIComponent(url.pathname + url.search)}`);
	}

	// Deep link from the public calendar's "Edit" action (?edit=<id>).
	const editId = url.searchParams.get('edit');
	let editEvent: CommunityEventRecord | null = null;
	if (editId) {
		try {
			editEvent = await getEventForActor(editId, { id: user.id, role });
		} catch (err) {
			if (err instanceof CommunityEventError) throw error(err.statusCode, err.message);
			throw err;
		}
	}

	const events = await listEventsForUser(user.id);

	return {
		events,
		editEvent,
		role,
		eventsEnabled: isSupabaseAdminConfigured()
	};
};
