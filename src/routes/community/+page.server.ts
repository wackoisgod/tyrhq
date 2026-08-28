import type { PageServerLoad } from './$types';
import { listUpcomingEvents } from '$lib/server/events';
import { listPublicCommunityGroups } from '$lib/server/community-links';

export const load: PageServerLoad = async () => {
	const [upcomingEvents, communityGroups] = await Promise.all([
		listUpcomingEvents(5),
		listPublicCommunityGroups()
	]);
	return { upcomingEvents, communityGroups };
};
