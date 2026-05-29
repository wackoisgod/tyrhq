import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	generateBracket,
	getTournamentBySlug,
	listCaptainTeams,
	listTeams,
	recordMatchResult,
	registerTeam,
	resultSchema,
	seedTeam,
	TournamentError,
	updateTournament,
	updateTournamentLogo,
	updateTournamentSchema,
	uploadTournamentLogo
} from '$lib/server/tournaments';

function datetimeLocalToIso(value: FormDataEntryValue | null) {
	const raw = String(value ?? '').trim();
	if (!raw) return '';
	const time = new Date(raw).getTime();
	return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const { user, role } = await locals.safeGetSession();
	const tournament = await getTournamentBySlug(params.slug, user?.id ?? null, role);
	if (!tournament) error(404, 'Tournament not found');
	return {
		tournament,
		role,
		userId: user?.id ?? null,
		loginHref: `/auth?next=${encodeURIComponent(url.pathname)}`,
		captainTeams: user ? await listCaptainTeams(user.id) : [],
		allTeams: tournament.canManage ? await listTeams() : []
	};
};

export const actions: Actions = {
	update: async ({ request, locals }) => {
		const { session, user, role } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		const parsed = updateTournamentSchema.safeParse({
			name: String(form.get('name') ?? ''),
			summary: String(form.get('summary') ?? ''),
			startsAt: datetimeLocalToIso(form.get('startsAt')),
			registrationClosesAt: datetimeLocalToIso(form.get('registrationClosesAt')),
			registrationMode: String(form.get('registrationMode') ?? 'open'),
			status: String(form.get('status') ?? 'draft'),
			teamSize: 8,
			substituteCount: Number(form.get('substituteCount') ?? 1),
			rulesUrl: String(form.get('rulesUrl') ?? ''),
			discordUrl: String(form.get('discordUrl') ?? '')
		});
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid tournament' });
		}

		try {
			await updateTournament(String(form.get('tournamentId') ?? ''), parsed.data, user.id, role);
			return { success: 'Tournament updated.' };
		} catch (err) {
			if (err instanceof TournamentError) return fail(err.statusCode, { error: err.message });
			throw err;
		}
	},
	register: async ({ request, locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		try {
			await registerTeam(String(form.get('tournamentId') ?? ''), String(form.get('teamId') ?? ''), user.id);
			return { success: 'Team registered.' };
		} catch (err) {
			if (err instanceof TournamentError) return fail(err.statusCode, { error: err.message });
			throw err;
		}
	},
	seed: async ({ request, locals }) => {
		const { session, user, role } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		try {
			await seedTeam(
				String(form.get('tournamentId') ?? ''),
				String(form.get('teamId') ?? ''),
				Number(form.get('seed') ?? 1),
				user.id,
				role
			);
			return { success: 'Seed saved.' };
		} catch (err) {
			if (err instanceof TournamentError) return fail(err.statusCode, { error: err.message });
			throw err;
		}
	},
	bracket: async ({ request, locals }) => {
		const { session, user, role } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		try {
			await generateBracket(String(form.get('tournamentId') ?? ''), user.id, role);
			return { success: 'Bracket generated.' };
		} catch (err) {
			if (err instanceof TournamentError) return fail(err.statusCode, { error: err.message });
			throw err;
		}
	},
	result: async ({ request, locals }) => {
		const { session, user, role } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		const parsed = resultSchema.safeParse({
			matchId: String(form.get('matchId') ?? ''),
			scoreA: Number(form.get('scoreA') ?? 0),
			scoreB: Number(form.get('scoreB') ?? 0),
			winnerTeamId: String(form.get('winnerTeamId') ?? '')
		});
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid result' });
		try {
			await recordMatchResult(parsed.data, user.id, role);
			return { success: 'Result saved.' };
		} catch (err) {
			if (err instanceof TournamentError) return fail(err.statusCode, { error: err.message });
			throw err;
		}
	},
	logo: async ({ request, locals, params }) => {
		const { session, user, role } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const tournament = await getTournamentBySlug(params.slug, user.id, role);
		if (!tournament) error(404, 'Tournament not found');
		const form = await request.formData();
		try {
			const logoUrl = await uploadTournamentLogo(form.get('logo') as File | null, user.id);
			if (logoUrl) await updateTournamentLogo(tournament.id, logoUrl, user.id, role);
			redirect(303, `/tournaments/${tournament.slug}`);
		} catch (err) {
			if (err instanceof TournamentError) return fail(err.statusCode, { error: err.message });
			throw err;
		}
	}
};
