import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getTeamBySlug,
	joinTeam,
	leaveTeam,
	TournamentError,
	updateTeam,
	updateTeamLogo,
	updateTeamSchema,
	uploadTournamentLogo
} from '$lib/server/tournaments';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const { user, role } = await locals.safeGetSession();
	const team = await getTeamBySlug(params.slug);
	if (!team) error(404, 'Team not found');
	return {
		team,
		userId: user?.id ?? null,
		role,
		isMember: Boolean(user && team.members.some((member) => member.userId === user.id)),
		isCaptain: Boolean(user && team.captainId === user.id),
		loginHref: `/auth?next=${encodeURIComponent(url.pathname)}`
	};
};

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		const { session, user, role } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const team = await getTeamBySlug(params.slug);
		if (!team) error(404, 'Team not found');
		const form = await request.formData();
		const parsed = updateTeamSchema.safeParse({
			name: String(form.get('name') ?? ''),
			description: String(form.get('description') ?? '')
		});
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid team' });

		try {
			await updateTeam(team.id, parsed.data, user.id, role);
			return { success: 'Team updated.' };
		} catch (err) {
			if (err instanceof TournamentError) return fail(err.statusCode, { error: err.message });
			throw err;
		}
	},
	join: async ({ request, locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		try {
			await joinTeam(String(form.get('teamId') ?? ''), user.id);
			return { success: 'Joined team.' };
		} catch (err) {
			if (err instanceof TournamentError) return fail(err.statusCode, { error: err.message });
			throw err;
		}
	},
	leave: async ({ request, locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		try {
			await leaveTeam(String(form.get('teamId') ?? ''), user.id);
			return { success: 'Left team.' };
		} catch (err) {
			if (err instanceof TournamentError) return fail(err.statusCode, { error: err.message });
			throw err;
		}
	},
	logo: async ({ request, locals, params }) => {
		const { session, user, role } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const team = await getTeamBySlug(params.slug);
		if (!team) error(404, 'Team not found');
		const form = await request.formData();
		try {
			const logoUrl = await uploadTournamentLogo(form.get('logo') as File | null, user.id);
			if (logoUrl) await updateTeamLogo(team.id, logoUrl, user.id, role);
			redirect(303, `/teams/${team.slug}`);
		} catch (err) {
			if (err instanceof TournamentError) return fail(err.statusCode, { error: err.message });
			throw err;
		}
	}
};
