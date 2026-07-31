import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	addTournamentTeam,
	generateBracket,
	getTournamentBySlug,
	listCaptainTeams,
	listTeams,
	recordMatchResult,
	registerTeam,
	reopenTournamentRegistration,
	resultSchema,
	removeTournamentTeam,
	saveTournamentSeeds,
	seedOrderSchema,
	TournamentError,
	updateTournament,
	updateTournamentLogo,
	updateTournamentSchema,
	uploadTournamentLogo
} from '$lib/server/tournaments';
import {
	cancelTournamentPickupRequest,
	freeAgentProfileSchema,
	getTournamentFreeAgentContext,
	registerTournamentFreeAgent,
	requestTournamentPickup,
	reviewTournamentPickupRequest,
	setTournamentTeamRecruiting,
	withdrawTournamentFreeAgent
} from '$lib/server/tournament-participation';
import {
	getTournamentBuildContext,
	removeTournamentBuild,
	submitTournamentBuild,
	tournamentBuildSchema
} from '$lib/server/tournament-series';

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
	const captainTeams = user ? await listCaptainTeams(user.id) : [];
	const [freeAgentContext, buildContext] = await Promise.all([
		getTournamentFreeAgentContext(
			tournament.id,
			user?.id ?? null,
			captainTeams.map((team) => team.id)
		),
		getTournamentBuildContext(tournament.id, user?.id ?? null, role)
	]);
	return {
		tournament,
		role,
		userId: user?.id ?? null,
		initialTab:
			(['overview', 'teams', 'free-agents', 'loadouts', 'bracket'] as const).find(
				(tab) => tab === url.searchParams.get('tab')
			) ?? 'overview',
		loginHref: `/auth?next=${encodeURIComponent(url.pathname)}`,
		captainTeams,
		allTeams: tournament.canManage ? await listTeams() : [],
		freeAgentContext,
		buildContext
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
	reopenRegistration: async ({ request, locals }) => {
		const { session, user, role } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		const closesAt = datetimeLocalToIso(form.get('registrationClosesAt'));
		try {
			await reopenTournamentRegistration(
				String(form.get('tournamentId') ?? ''),
				closesAt,
				user.id,
				role
			);
			return { success: 'Registration reopened.' };
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
	addTeam: async ({ request, locals }) => {
		const { session, user, role } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		const teamId = String(form.get('teamId') ?? '');
		if (!seedOrderSchema.safeParse([teamId]).success) {
			return fail(400, { error: 'Select a valid team.' });
		}
		try {
			const rosterCount = await addTournamentTeam(String(form.get('tournamentId') ?? ''), teamId, user.id, role);
			return { success: `Team force registered with ${rosterCount} tournament roster member${rosterCount === 1 ? '' : 's'}. Roster limits were bypassed.` };
		} catch (err) {
			if (err instanceof TournamentError) return fail(err.statusCode, { error: err.message });
			throw err;
		}
	},
	removeTeam: async ({ request, locals }) => {
		const { session, user, role } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		const teamId = String(form.get('teamId') ?? '');
		if (!seedOrderSchema.safeParse([teamId]).success) {
			return fail(400, { error: 'Select a valid team.' });
		}
		try {
			await removeTournamentTeam(String(form.get('tournamentId') ?? ''), teamId, user.id, role);
			return { success: 'Team removed. Save the ranking to close any seed gaps.' };
		} catch (err) {
			if (err instanceof TournamentError) return fail(err.statusCode, { error: err.message });
			throw err;
		}
	},
	seeds: async ({ request, locals }) => {
		const { session, user, role } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		let submittedOrder: unknown;
		try {
			submittedOrder = JSON.parse(String(form.get('teamIds') ?? '[]'));
		} catch {
			return fail(400, { error: 'The submitted ranking is invalid.' });
		}
		const parsed = seedOrderSchema.safeParse(submittedOrder);
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid ranking.' });
		}
		try {
			await saveTournamentSeeds(
				String(form.get('tournamentId') ?? ''),
				parsed.data,
				user.id,
				role
			);
			return { success: 'Ranking saved.' };
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
	freeAgent: async ({ request, locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		const parsed = freeAgentProfileSchema.safeParse({
			preferredRole: String(form.get('preferredRole') ?? ''),
			note: String(form.get('note') ?? '')
		});
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid free-agent profile.' });
		try {
			await registerTournamentFreeAgent(String(form.get('tournamentId') ?? ''), user.id, parsed.data);
			return { success: 'You are listed as an available free agent.' };
		} catch (err) {
			if (err instanceof TournamentError) return fail(err.statusCode, { error: err.message });
			throw err;
		}
	},
	withdrawFreeAgent: async ({ request, locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		try {
			await withdrawTournamentFreeAgent(String(form.get('tournamentId') ?? ''), user.id);
			return { success: 'You left the free-agent pool.' };
		} catch (err) {
			if (err instanceof TournamentError) return fail(err.statusCode, { error: err.message });
			throw err;
		}
	},
	recruiting: async ({ request, locals }) => {
		const { session, user, role } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		const teamId = String(form.get('teamId') ?? '');
		if (!seedOrderSchema.safeParse([teamId]).success) return fail(400, { error: 'Select a valid team.' });
		const isRecruiting = String(form.get('isRecruiting') ?? '') === 'true';
		try {
			const rosterCount = await setTournamentTeamRecruiting(
				String(form.get('tournamentId') ?? ''),
				teamId,
				isRecruiting,
				user.id,
				role
			);
			return { success: isRecruiting ? `Team is recruiting with ${rosterCount} player${rosterCount === 1 ? '' : 's'} on its tournament roster.` : 'Tournament recruiting paused.' };
		} catch (err) {
			if (err instanceof TournamentError) return fail(err.statusCode, { error: err.message });
			throw err;
		}
	},
	requestPickup: async ({ request, locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		const teamId = String(form.get('teamId') ?? '');
		if (!seedOrderSchema.safeParse([teamId]).success) return fail(400, { error: 'Select a valid team.' });
		try {
			await requestTournamentPickup(String(form.get('tournamentId') ?? ''), teamId, user.id);
			return { success: 'Pickup request sent to the team captain.' };
		} catch (err) {
			if (err instanceof TournamentError) return fail(err.statusCode, { error: err.message });
			throw err;
		}
	},
	cancelPickup: async ({ request, locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		const teamId = String(form.get('teamId') ?? '');
		if (!seedOrderSchema.safeParse([teamId]).success) return fail(400, { error: 'Select a valid team.' });
		try {
			await cancelTournamentPickupRequest(String(form.get('tournamentId') ?? ''), teamId, user.id);
			return { success: 'Pickup request cancelled.' };
		} catch (err) {
			if (err instanceof TournamentError) return fail(err.statusCode, { error: err.message });
			throw err;
		}
	},
	reviewPickup: async ({ request, locals }) => {
		const { session, user, role } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		const teamId = String(form.get('teamId') ?? '');
		const freeAgentId = String(form.get('freeAgentId') ?? '');
		const decision = String(form.get('decision') ?? '');
		if (
			!seedOrderSchema.safeParse([teamId]).success ||
			!seedOrderSchema.safeParse([freeAgentId]).success ||
			(decision !== 'approve' && decision !== 'reject')
		) {
			return fail(400, { error: 'Invalid pickup review.' });
		}
		try {
			await reviewTournamentPickupRequest(
				String(form.get('tournamentId') ?? ''),
				teamId,
				freeAgentId,
				decision,
				user.id,
				role
			);
			return { success: decision === 'approve' ? 'Free agent added to the tournament roster.' : 'Pickup request rejected.' };
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
	submitBuild: async ({ request, locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		const parsed = tournamentBuildSchema.safeParse({
			tournamentId: String(form.get('tournamentId') ?? ''),
			buildId: String(form.get('buildId') ?? ''),
			visibility: String(form.get('visibility') ?? 'after_match')
		});
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid build submission.' });
		}
		try {
			await submitTournamentBuild(parsed.data, user.id);
			return { success: 'Tournament build submitted.' };
		} catch (err) {
			if (err instanceof TournamentError) return fail(err.statusCode, { error: err.message });
			throw err;
		}
	},
	removeBuild: async ({ request, locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		const tournamentId = String(form.get('tournamentId') ?? '');
		const submissionId = String(form.get('submissionId') ?? '');
		if (
			!seedOrderSchema.safeParse([tournamentId]).success ||
			!seedOrderSchema.safeParse([submissionId]).success
		) {
			return fail(400, { error: 'Invalid build submission.' });
		}
		try {
			await removeTournamentBuild(tournamentId, submissionId, user.id);
			return { success: 'Tournament build removed.' };
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
