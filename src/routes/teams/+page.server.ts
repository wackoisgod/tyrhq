import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	createTeam,
	createTeamSchema,
	listCaptainTeams,
	listTeams,
	TournamentError
} from '$lib/server/tournaments';

export const load: PageServerLoad = async ({ locals, url }) => {
	const { user } = await locals.safeGetSession();
	const captainTeams = user ? await listCaptainTeams(user.id) : [];
	return {
		teams: await listTeams(),
		captainTeams,
		isSignedIn: Boolean(user),
		showCreate: url.searchParams.get('create') === '1'
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });

		const form = await request.formData();
		const parsed = createTeamSchema.safeParse({
			name: String(form.get('name') ?? ''),
			description: String(form.get('description') ?? '')
		});
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid team' });
		}

		try {
			const team = await createTeam(parsed.data, user.id);
			redirect(303, `/teams/${team.slug}`);
		} catch (err) {
			if (err instanceof TournamentError) return fail(err.statusCode, { error: err.message });
			throw err;
		}
	}
};
