import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import { getPlayerCompetitionProfile } from '$lib/server/player-profiles';

export const load: PageServerLoad = async ({ params }) => {
	const player = await getPlayerCompetitionProfile(params.id);
	if (!player) throw error(404, 'Player not found');
	return { player };
};
