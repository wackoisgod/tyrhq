import type { PageServerLoad } from './$types';
import { listTournaments } from '$lib/server/tournaments';

export const load: PageServerLoad = async () => {
	return listTournaments();
};
