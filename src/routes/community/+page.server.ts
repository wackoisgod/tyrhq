import type { PageServerLoad } from './$types';
import { listUpcomingEvents } from '$lib/server/events';

export const load: PageServerLoad = async () => {
	const upcomingEvents = await listUpcomingEvents(5);
	return { upcomingEvents };
};
