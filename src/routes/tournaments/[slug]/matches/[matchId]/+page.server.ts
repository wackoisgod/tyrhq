import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

import {
	getTournamentBySlug,
	recordMatchResult,
	resultSchema,
	TournamentError
} from '$lib/server/tournaments';
import {
	getTournamentMatchDetail,
	lineupSchema,
	matchGameSchema,
	matchSettingsSchema,
	saveTournamentGameLineup,
	saveTournamentMatchGame,
	updateTournamentMatchSettings
} from '$lib/server/tournament-series';

function datetimeLocalToIso(value: FormDataEntryValue | null) {
	const raw = String(value ?? '').trim();
	if (!raw) return '';
	const time = new Date(raw).getTime();
	return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

function tournamentFailure(caught: unknown) {
	if (caught instanceof TournamentError) return fail(caught.statusCode, { error: caught.message });
	throw caught;
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const { user, role } = await locals.safeGetSession();
	const tournament = await getTournamentBySlug(params.slug, user?.id ?? null, role);
	if (!tournament) error(404, 'Tournament not found');
	try {
		const detail = await getTournamentMatchDetail(
			tournament.id,
			params.matchId,
			user?.id ?? null,
			role
		);
		return {
			tournament,
			detail,
			loginHref: `/auth?next=${encodeURIComponent(url.pathname)}`
		};
	} catch (caught) {
		if (caught instanceof TournamentError && caught.statusCode === 404) {
			error(404, caught.message);
		}
		throw caught;
	}
};

export const actions: Actions = {
	settings: async ({ request, locals }) => {
		const { session, user, role } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		const parsed = matchSettingsSchema.safeParse({
			matchId: String(form.get('matchId') ?? ''),
			bestOf: Number(form.get('bestOf') ?? 5),
			scheduledAt: datetimeLocalToIso(form.get('scheduledAt')),
			streamUrl: String(form.get('streamUrl') ?? ''),
			notes: String(form.get('notes') ?? '')
		});
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid match settings.' });
		}
		try {
			await updateTournamentMatchSettings(parsed.data, user.id, role);
			return { success: 'Match settings saved.' };
		} catch (caught) {
			return tournamentFailure(caught);
		}
	},
	game: async ({ request, locals }) => {
		const { session, user, role } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		const parsed = matchGameSchema.safeParse({
			matchId: String(form.get('matchId') ?? ''),
			gameNumber: Number(form.get('gameNumber') ?? 0),
			mapId: String(form.get('mapId') ?? ''),
			pickedByTeamId: String(form.get('pickedByTeamId') ?? ''),
			winnerTeamId: String(form.get('winnerTeamId') ?? ''),
			vodUrl: String(form.get('vodUrl') ?? ''),
			notes: String(form.get('notes') ?? '')
		});
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid game details.' });
		}
		try {
			const state = await saveTournamentMatchGame(parsed.data, user.id, role);
			return {
				success: state.isComplete
					? 'Game saved and series completed.'
					: `Game saved. Series score is ${state.scoreA}-${state.scoreB}.`
			};
		} catch (caught) {
			return tournamentFailure(caught);
		}
	},
	lineup: async ({ request, locals }) => {
		const { session, user, role } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		const parsed = lineupSchema.safeParse({
			gameId: String(form.get('gameId') ?? ''),
			userId: String(form.get('userId') ?? user.id),
			vehicleId: String(form.get('vehicleId') ?? ''),
			buildSubmissionId: String(form.get('buildSubmissionId') ?? '')
		});
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid game loadout.' });
		}
		try {
			await saveTournamentGameLineup(parsed.data, user.id, role);
			return { success: parsed.data.vehicleId ? 'Game loadout saved.' : 'Game loadout cleared.' };
		} catch (caught) {
			return tournamentFailure(caught);
		}
	},
	quickResult: async ({ request, locals }) => {
		const { session, user, role } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		const parsed = resultSchema.safeParse({
			matchId: String(form.get('matchId') ?? ''),
			scoreA: Number(form.get('scoreA') ?? 0),
			scoreB: Number(form.get('scoreB') ?? 0),
			winnerTeamId: String(form.get('winnerTeamId') ?? '')
		});
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid result.' });
		}
		try {
			await recordMatchResult(parsed.data, user.id, role);
			return { success: 'Quick series result saved.' };
		} catch (caught) {
			return tournamentFailure(caught);
		}
	}
};
