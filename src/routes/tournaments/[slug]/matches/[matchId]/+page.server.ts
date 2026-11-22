import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

import {
	getTournamentBySlug,
	recordMatchResult,
	resultSchema,
	TournamentError
} from '$lib/server/tournaments';
import {
	batchMatchGamesSchema,
	getTournamentMatchDetail,
	lineupSchema,
	matchGameSchema,
	matchSettingsSchema,
	saveTournamentGameLineup,
	saveTournamentMatchGame,
	saveTournamentMatchGames,
	updateTournamentMatchSettings
} from '$lib/server/tournament-series';
import { generateAutoFillSuggestions } from '$lib/server/replay-upload';

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
			targetScore: form.get('targetScore') ? Number(form.get('targetScore')) : '',
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
	},
	batchGames: async ({ request, locals }) => {
		const { session, user, role } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const form = await request.formData();
		const matchId = String(form.get('matchId') ?? '');
		const gamesJson = String(form.get('games') ?? '[]');
		let games;
		try {
			games = JSON.parse(gamesJson);
		} catch {
			return fail(400, { error: 'Invalid games data format.' });
		}
		const parsed = batchMatchGamesSchema.safeParse({ matchId, games });
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid game details.' });
		}
		try {
			const state = await saveTournamentMatchGames(parsed.data, user.id, role);
			return {
				success: state.isComplete
					? 'All games saved and series completed.'
					: `All games saved. Series score is ${state.scoreA}-${state.scoreB}.`
			};
		} catch (caught) {
			return tournamentFailure(caught);
		}
	},
	parseReplay: async ({ request, locals, params }) => {
		const { session, user, role } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		
		const form = await request.formData();
		const replayFile = form.get('replayFile') as File | null;
		const matchId = String(form.get('matchId') ?? '');
		
		if (!replayFile || replayFile.size === 0) {
			return fail(400, { error: 'Please select a replay file.' });
		}
		
		// Validate file size (max 50MB)
		const MAX_SIZE = 50 * 1024 * 1024;
		if (replayFile.size > MAX_SIZE) {
			return fail(400, { error: 'Replay file is too large (max 50MB).' });
		}
		
		try {
			// Read file into buffer
			const arrayBuffer = await replayFile.arrayBuffer();
			const buffer = new Uint8Array(arrayBuffer);
			
			// Get tournament and match details
			const tournament = await getTournamentBySlug(params.slug, user.id, role);
			if (!tournament) return fail(404, { error: 'Tournament not found' });
			
			const detail = await getTournamentMatchDetail(tournament.id, matchId, user.id, role);
			if (!detail.canManage) {
				return fail(403, { error: 'You do not have permission to manage this match.' });
			}
			
			if (!detail.match.teamA || !detail.match.teamB) {
				return fail(400, { error: 'Match must have both teams assigned.' });
			}
			
			// Generate suggestions
			const result = await generateAutoFillSuggestions(
				buffer,
				tournament.id,
				matchId,
				detail.match.teamA.id,
				detail.match.teamB.id
			);
			
			if (!result.success) {
				return fail(400, { error: result.error });
			}
			
			return {
				success: 'Replay parsed successfully. Review suggestions below.',
				replaySuggestions: result.suggestions
			};
		} catch (caught) {
			return fail(500, { 
				error: caught instanceof Error ? caught.message : 'Failed to parse replay file.' 
			});
		}
	}
};
