import { z } from 'zod';

import { getGameDataBundle } from '$lib/data/game-data';

import { getSupabaseAdminClient } from './supabase-admin';
import { recordMatchResult, TournamentError } from './tournaments';

const URL_MAX = 500;
const NOTES_MAX = 1000;
const GAME_NOTES_MAX = 500;

const optionalUrlSchema = z
	.string()
	.trim()
	.max(URL_MAX)
	.url('Must be a valid URL')
	.optional()
	.or(z.literal('').transform(() => undefined));

export const matchSettingsSchema = z
	.object({
		matchId: z.string().uuid(),
		bestOf: z.number().int().min(1).max(15).refine((value) => value % 2 === 1, 'Best-of must be an odd number'),
		scheduledAt: z.string().datetime({ offset: true }).optional().or(z.literal('')),
		streamUrl: optionalUrlSchema,
		notes: z.string().trim().max(NOTES_MAX).optional()
	})
	.strict();

export const matchGameSchema = z
	.object({
		matchId: z.string().uuid(),
		gameNumber: z.number().int().min(1).max(15),
		mapId: z.string().trim().min(1).max(120),
		pickedByTeamId: z.string().uuid(),
		winnerTeamId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
		vodUrl: optionalUrlSchema,
		notes: z.string().trim().max(GAME_NOTES_MAX).optional()
	})
	.strict();

export const tournamentBuildSchema = z
	.object({
		tournamentId: z.string().uuid(),
		buildId: z.string().uuid(),
		visibility: z.enum(['immediate', 'after_match', 'after_tournament'])
	})
	.strict();

export const lineupSchema = z
	.object({
		gameId: z.string().uuid(),
		userId: z.string().uuid(),
		vehicleId: z.string().trim().max(160).optional(),
		buildSubmissionId: z.string().uuid().optional().or(z.literal('').transform(() => undefined))
	})
	.strict();

type TournamentStatus = 'draft' | 'open' | 'in_progress' | 'completed' | 'cancelled';
type BuildVisibility = 'immediate' | 'after_match' | 'after_tournament';

interface TournamentRow {
	id: string;
	slug: string;
	name: string;
	organizer_id: string;
	status: TournamentStatus;
}

interface MatchRow {
	id: string;
	tournament_id: string;
	round: number;
	match_number: number;
	team_a_id: string | null;
	team_b_id: string | null;
	score_a: number;
	score_b: number;
	winner_team_id: string | null;
	status: 'pending' | 'completed';
	completed_at: string | null;
	best_of: number;
	scheduled_at: string | null;
	stream_url: string | null;
	notes: string | null;
}

interface GameRow {
	id: string;
	match_id: string;
	game_number: number;
	map_id: string;
	map_picked_by_team_id: string;
	winner_team_id: string | null;
	vod_url: string | null;
	notes: string | null;
	created_at: string;
	updated_at: string;
}

interface RosterRow {
	tournament_id: string;
	team_id: string;
	user_id: string;
	source: 'team' | 'free_agent';
}

interface BuildSubmissionRow {
	id: string;
	tournament_id: string;
	user_id: string;
	build_id: string | null;
	build_slug_snapshot: string;
	build_title_snapshot: string;
	vehicle_id: string;
	build_snapshot: unknown;
	visibility: BuildVisibility;
	submitted_at: string;
	updated_at: string;
}

interface LineupRow {
	game_id: string;
	team_id: string;
	user_id: string;
	vehicle_id: string;
	build_submission_id: string | null;
	submitted_by: string | null;
	updated_at: string;
}

function requireAdminClient() {
	const admin = getSupabaseAdminClient();
	if (!admin) throw new TournamentError('Tournament tools require SUPABASE_SERVICE_ROLE_KEY.', 503);
	return admin;
}

async function getTournament(tournamentId: string) {
	const admin = requireAdminClient();
	const { data, error } = await admin
		.from('tournaments')
		.select('id, slug, name, organizer_id, status')
		.eq('id', tournamentId)
		.maybeSingle<TournamentRow>();
	if (error) throw new TournamentError('Could not load tournament series.', 500);
	if (!data) throw new TournamentError('Tournament not found.', 404);
	return data;
}

function canManageTournament(tournament: TournamentRow, actorId: string | null | undefined, role: string) {
	return Boolean(actorId && (actorId === tournament.organizer_id || role === 'admin'));
}

async function assertTournamentManager(tournamentId: string, actorId: string, role: string) {
	const tournament = await getTournament(tournamentId);
	if (!canManageTournament(tournament, actorId, role)) {
		throw new TournamentError('Only the tournament organizer can manage this tournament.', 403);
	}
	return tournament;
}

export function calculateSeriesState(
	bestOf: number,
	winnerTeamIds: Array<string | null | undefined>,
	teamAId: string,
	teamBId: string
) {
	if (!Number.isInteger(bestOf) || bestOf < 1 || bestOf > 15 || bestOf % 2 !== 1) {
		throw new Error('Best-of must be an odd number between 1 and 15.');
	}
	const scoreA = winnerTeamIds.filter((winnerId) => winnerId === teamAId).length;
	const scoreB = winnerTeamIds.filter((winnerId) => winnerId === teamBId).length;
	const winsRequired = Math.floor(bestOf / 2) + 1;
	const winnerTeamId = scoreA >= winsRequired ? teamAId : scoreB >= winsRequired ? teamBId : null;
	return { scoreA, scoreB, winsRequired, winnerTeamId, isComplete: Boolean(winnerTeamId) };
}

async function getReleasedSubmissionIds(submissions: BuildSubmissionRow[], tournamentStatus: TournamentStatus) {
	const released = new Set<string>();
	for (const submission of submissions) {
		if (submission.visibility === 'immediate') released.add(submission.id);
		if (submission.visibility === 'after_tournament' && tournamentStatus === 'completed') released.add(submission.id);
	}

	const afterMatchIds = submissions
		.filter((submission) => submission.visibility === 'after_match')
		.map((submission) => submission.id);
	if (afterMatchIds.length === 0) return released;

	const admin = requireAdminClient();
	const { data: lineups } = await admin
		.from('tournament_game_lineups')
		.select('game_id, build_submission_id')
		.in('build_submission_id', afterMatchIds);
	const lineupRows = (lineups as Pick<LineupRow, 'game_id' | 'build_submission_id'>[] | null) ?? [];
	const gameIds = [...new Set(lineupRows.map((row) => row.game_id))];
	if (gameIds.length === 0) return released;

	const { data: games } = await admin
		.from('tournament_match_games')
		.select('id, match_id')
		.in('id', gameIds);
	const gameRows = (games as { id: string; match_id: string }[] | null) ?? [];
	const matchIds = [...new Set(gameRows.map((row) => row.match_id))];
	if (matchIds.length === 0) return released;

	const { data: matches } = await admin
		.from('tournament_matches')
		.select('id, status')
		.in('id', matchIds);
	const completedMatches = new Set(
		((matches as { id: string; status: MatchRow['status'] }[] | null) ?? [])
			.filter((match) => match.status === 'completed')
			.map((match) => match.id)
	);
	const matchByGame = new Map(gameRows.map((game) => [game.id, game.match_id]));
	for (const lineup of lineupRows) {
		const matchId = matchByGame.get(lineup.game_id);
		if (matchId && completedMatches.has(matchId) && lineup.build_submission_id) {
			released.add(lineup.build_submission_id);
		}
	}
	return released;
}

export async function getTournamentBuildContext(
	tournamentId: string,
	viewerId: string | null,
	role = 'user'
) {
	const admin = requireAdminClient();
	const tournament = await getTournament(tournamentId);
	const canManage = canManageTournament(tournament, viewerId, role);
	const [{ data: submissionsData }, { data: rosterData }] = await Promise.all([
		admin
			.from('tournament_build_submissions')
			.select('*')
			.eq('tournament_id', tournamentId)
			.order('submitted_at', { ascending: true }),
		admin
			.from('tournament_roster_members')
			.select('tournament_id, team_id, user_id, source')
			.eq('tournament_id', tournamentId)
	]);
	const submissions = (submissionsData as BuildSubmissionRow[] | null) ?? [];
	const roster = (rosterData as RosterRow[] | null) ?? [];
	const releasedIds = await getReleasedSubmissionIds(submissions, tournament.status);
	const profileIds = [...new Set(submissions.map((submission) => submission.user_id))];
	const { data: profilesData } = profileIds.length
		? await admin.from('profiles').select('id, display_name').in('id', profileIds)
		: { data: [] };
	const profileNames = new Map(
		((profilesData as { id: string; display_name: string | null }[] | null) ?? []).map((profile) => [
			profile.id,
			profile.display_name ?? 'Unknown player'
		])
	);
	const vehicleNames = new Map(
		getGameDataBundle().vehicles.map((vehicle) => [vehicle.id, vehicle.name])
	);

	const visibleSubmissions = submissions.filter(
		(submission) => canManage || submission.user_id === viewerId || releasedIds.has(submission.id)
	);
	const viewerRoster = viewerId ? roster.find((member) => member.user_id === viewerId) ?? null : null;
	const { data: buildsData } = viewerId
		? await admin
				.from('builds')
				.select('id, slug, title, vehicle_id, is_public, updated_at')
				.eq('user_id', viewerId)
				.eq('is_public', true)
				.order('updated_at', { ascending: false })
		: { data: [] };

	return {
		canSubmit: Boolean(
			viewerRoster && tournament.status !== 'completed' && tournament.status !== 'cancelled'
		),
		viewerTeamId: viewerRoster?.team_id ?? null,
		availableBuilds: ((buildsData as {
			id: string;
			slug: string;
			title: string;
			vehicle_id: string;
			is_public: boolean;
			updated_at: string;
		}[] | null) ?? []).map((build) => ({
			id: build.id,
			slug: build.slug,
			title: build.title,
			vehicleId: build.vehicle_id,
			vehicleName: vehicleNames.get(build.vehicle_id) ?? build.vehicle_id,
			updatedAt: build.updated_at
		})),
		submissions: visibleSubmissions.map((submission) => ({
			id: submission.id,
			userId: submission.user_id,
			displayName: profileNames.get(submission.user_id) ?? 'Unknown player',
			buildId: submission.build_id,
			buildSlug: submission.build_slug_snapshot,
			buildTitle: submission.build_title_snapshot,
			vehicleId: submission.vehicle_id,
			vehicleName: vehicleNames.get(submission.vehicle_id) ?? submission.vehicle_id,
			visibility: submission.visibility,
			submittedAt: submission.submitted_at,
			isOwner: submission.user_id === viewerId,
			isPubliclyVisible: releasedIds.has(submission.id),
			canOpen: Boolean(submission.build_id)
		}))
	};
}

export async function submitTournamentBuild(
	input: z.infer<typeof tournamentBuildSchema>,
	actorId: string
) {
	const admin = requireAdminClient();
	const tournament = await getTournament(input.tournamentId);
	if (tournament.status === 'completed' || tournament.status === 'cancelled') {
		throw new TournamentError('Build submissions are closed for this tournament.', 409);
	}
	const [{ data: roster }, { data: build }] = await Promise.all([
		admin
			.from('tournament_roster_members')
			.select('user_id')
			.eq('tournament_id', input.tournamentId)
			.eq('user_id', actorId)
			.maybeSingle<{ user_id: string }>(),
		admin
			.from('builds')
			.select('id, user_id, slug, title, vehicle_id, selection, is_public')
			.eq('id', input.buildId)
			.eq('user_id', actorId)
			.maybeSingle<{
				id: string;
				user_id: string;
				slug: string;
				title: string;
				vehicle_id: string;
				selection: unknown;
				is_public: boolean;
			}>()
	]);
	if (!roster) throw new TournamentError('Only tournament roster members can submit builds.', 403);
	if (!build) throw new TournamentError('Build not found.', 404);
	if (!build.is_public) throw new TournamentError('Make the build public before submitting it.', 409);

	const { error } = await admin.from('tournament_build_submissions').upsert(
		{
			tournament_id: input.tournamentId,
			user_id: actorId,
			build_id: build.id,
			build_slug_snapshot: build.slug,
			build_title_snapshot: build.title,
			vehicle_id: build.vehicle_id,
			build_snapshot: build.selection,
			visibility: input.visibility,
			updated_at: new Date().toISOString()
		},
		{ onConflict: 'tournament_id,user_id,build_id' }
	);
	if (error) throw new TournamentError('Could not submit tournament build.', 500);
}

export async function removeTournamentBuild(tournamentId: string, submissionId: string, actorId: string) {
	const admin = requireAdminClient();
	const { data: used } = await admin
		.from('tournament_game_lineups')
		.select('game_id')
		.eq('build_submission_id', submissionId)
		.limit(1)
		.maybeSingle<{ game_id: string }>();
	if (used) throw new TournamentError('A build used in a recorded game cannot be removed.', 409);
	const { data, error } = await admin
		.from('tournament_build_submissions')
		.delete()
		.eq('id', submissionId)
		.eq('tournament_id', tournamentId)
		.eq('user_id', actorId)
		.select('id')
		.maybeSingle();
	if (error) throw new TournamentError('Could not remove tournament build.', 500);
	if (!data) throw new TournamentError('Build submission not found.', 404);
}

export async function getTournamentMatchDetail(
	tournamentId: string,
	matchId: string,
	viewerId: string | null,
	role = 'user'
) {
	const admin = requireAdminClient();
	const tournament = await getTournament(tournamentId);
	const canManage = canManageTournament(tournament, viewerId, role);
	const { data: match, error: matchError } = await admin
		.from('tournament_matches')
		.select('*')
		.eq('id', matchId)
		.eq('tournament_id', tournamentId)
		.maybeSingle<MatchRow>();
	if (matchError) throw new TournamentError('Could not load match.', 500);
	if (!match) throw new TournamentError('Match not found.', 404);

	const teamIds = [match.team_a_id, match.team_b_id].filter((id): id is string => Boolean(id));
	const [{ data: teamsData }, { data: gamesData }, { data: rosterData }] = await Promise.all([
		teamIds.length
			? admin.from('teams').select('id, slug, name, logo_url').in('id', teamIds)
			: Promise.resolve({ data: [] }),
		admin
			.from('tournament_match_games')
			.select('*')
			.eq('match_id', matchId)
			.order('game_number', { ascending: true }),
		teamIds.length
			? admin
					.from('tournament_roster_members')
					.select('tournament_id, team_id, user_id, source')
					.eq('tournament_id', tournamentId)
					.in('team_id', teamIds)
			: Promise.resolve({ data: [] })
	]);
	const teams = (teamsData as { id: string; slug: string; name: string; logo_url: string | null }[] | null) ?? [];
	const games = (gamesData as GameRow[] | null) ?? [];
	const roster = (rosterData as RosterRow[] | null) ?? [];
	const userIds = [...new Set(roster.map((member) => member.user_id))];
	const gameIds = games.map((game) => game.id);
	const [{ data: profilesData }, { data: lineupsData }, buildContext] = await Promise.all([
		userIds.length
			? admin.from('profiles').select('id, display_name').in('id', userIds)
			: Promise.resolve({ data: [] }),
		gameIds.length
			? admin.from('tournament_game_lineups').select('*').in('game_id', gameIds)
			: Promise.resolve({ data: [] }),
		getTournamentBuildContext(tournamentId, viewerId, role)
	]);
	const profileNames = new Map(
		((profilesData as { id: string; display_name: string | null }[] | null) ?? []).map((profile) => [
			profile.id,
			profile.display_name ?? 'Unknown player'
		])
	);
	const allLineups = (lineupsData as LineupRow[] | null) ?? [];
	const canSeeAllLineups = canManage || match.status === 'completed' || tournament.status === 'completed';
	const visibleLineups = allLineups.filter(
		(lineup) => canSeeAllLineups || lineup.user_id === viewerId
	);
	const teamById = new Map(teams.map((team) => [team.id, team]));
	const bundle = getGameDataBundle();

	return {
		canManage,
		viewerId,
		viewerTeamId: roster.find((member) => member.user_id === viewerId)?.team_id ?? null,
		match: {
			id: match.id,
			round: match.round,
			matchNumber: match.match_number,
			scoreA: match.score_a,
			scoreB: match.score_b,
			winnerTeamId: match.winner_team_id,
			status: match.status,
			completedAt: match.completed_at,
			bestOf: match.best_of,
			scheduledAt: match.scheduled_at,
			streamUrl: match.stream_url,
			notes: match.notes,
			teamA: match.team_a_id ? teamById.get(match.team_a_id) ?? null : null,
			teamB: match.team_b_id ? teamById.get(match.team_b_id) ?? null : null
		},
		games: games.map((game) => ({
			id: game.id,
			gameNumber: game.game_number,
			mapId: game.map_id,
			pickedByTeamId: game.map_picked_by_team_id,
			winnerTeamId: game.winner_team_id,
			vodUrl: game.vod_url,
			notes: game.notes,
			updatedAt: game.updated_at
		})),
		rosters: teamIds.map((teamId) => ({
			teamId,
			teamName: teamById.get(teamId)?.name ?? 'Unknown team',
			members: roster
				.filter((member) => member.team_id === teamId)
				.map((member) => ({
					userId: member.user_id,
					displayName: profileNames.get(member.user_id) ?? 'Unknown player',
					source: member.source
				}))
		})),
		lineups: visibleLineups.map((lineup) => ({
			gameId: lineup.game_id,
			teamId: lineup.team_id,
			userId: lineup.user_id,
			vehicleId: lineup.vehicle_id,
			buildSubmissionId: lineup.build_submission_id,
			updatedAt: lineup.updated_at
		})),
		builds: buildContext,
		maps: bundle.maps
			.filter((map) => map.status === 'released')
			.map((map) => ({ id: map.id, slug: map.slug, name: map.displayName || map.name })),
		vehicles: bundle.vehicles
			.filter((vehicle) => vehicle.selectable && !vehicle.isWorkInProgress)
			.map((vehicle) => ({
				id: vehicle.id,
				slug: vehicle.slug,
				name: vehicle.name,
				classLabel: vehicle.classLabel
			}))
	};
}

export async function updateTournamentMatchSettings(
	input: z.infer<typeof matchSettingsSchema>,
	actorId: string,
	role: string
) {
	const admin = requireAdminClient();
	const { data: match } = await admin
		.from('tournament_matches')
		.select('id, tournament_id, status, best_of, score_a, score_b')
		.eq('id', input.matchId)
		.maybeSingle<Pick<MatchRow, 'id' | 'tournament_id' | 'status' | 'best_of' | 'score_a' | 'score_b'>>();
	if (!match) throw new TournamentError('Match not found.', 404);
	await assertTournamentManager(match.tournament_id, actorId, role);
	if (match.status === 'completed' && input.bestOf !== match.best_of) {
		throw new TournamentError('The format cannot change after a series is completed.', 409);
	}
	const { data: lastGame } = await admin
		.from('tournament_match_games')
		.select('game_number')
		.eq('match_id', match.id)
		.order('game_number', { ascending: false })
		.limit(1)
		.maybeSingle<{ game_number: number }>();
	if (lastGame && lastGame.game_number > input.bestOf) {
		throw new TournamentError('Best-of cannot be lower than an existing game number.', 409);
	}
	const winsRequired = Math.floor(input.bestOf / 2) + 1;
	if (match.status !== 'completed' && (match.score_a >= winsRequired || match.score_b >= winsRequired)) {
		throw new TournamentError('The new format conflicts with the current series score.', 409);
	}
	const { error } = await admin
		.from('tournament_matches')
		.update({
			best_of: input.bestOf,
			scheduled_at: input.scheduledAt || null,
			stream_url: input.streamUrl || null,
			notes: input.notes || null
		})
		.eq('id', match.id);
	if (error) throw new TournamentError('Could not update match settings.', 500);
}

export async function saveTournamentMatchGame(
	input: z.infer<typeof matchGameSchema>,
	actorId: string,
	role: string
) {
	const admin = requireAdminClient();
	const { data: match } = await admin
		.from('tournament_matches')
		.select('*')
		.eq('id', input.matchId)
		.maybeSingle<MatchRow>();
	if (!match) throw new TournamentError('Match not found.', 404);
	await assertTournamentManager(match.tournament_id, actorId, role);
	if (!match.team_a_id || !match.team_b_id) {
		throw new TournamentError('Both teams must be known before recording games.', 409);
	}
	if (input.gameNumber > match.best_of) {
		throw new TournamentError(`This series is best-of-${match.best_of}.`, 400);
	}
	const teamIds = new Set([match.team_a_id, match.team_b_id]);
	if (!teamIds.has(input.pickedByTeamId) || (input.winnerTeamId && !teamIds.has(input.winnerTeamId))) {
		throw new TournamentError('Map picker and winner must be teams in this match.', 400);
	}
	const mapExists = getGameDataBundle().maps.some(
		(map) => map.id === input.mapId && map.status === 'released'
	);
	if (!mapExists) throw new TournamentError('Select a released tournament map.', 400);

	const { data: gamesData } = await admin
		.from('tournament_match_games')
		.select('*')
		.eq('match_id', match.id);
	const games = (gamesData as GameRow[] | null) ?? [];
	const existing = games.find((game) => game.game_number === input.gameNumber);
	const simulatedWinners = games
		.filter((game) => game.game_number !== input.gameNumber)
		.map((game) => game.winner_team_id);
	simulatedWinners.push(input.winnerTeamId ?? null);
	const state = calculateSeriesState(match.best_of, simulatedWinners, match.team_a_id, match.team_b_id);
	if (
		match.status === 'completed' &&
		(state.scoreA > match.score_a || state.scoreB > match.score_b)
	) {
		throw new TournamentError('Game winners cannot exceed the saved final series score.', 409);
	}
	if (
		match.status === 'completed' &&
		existing?.winner_team_id &&
		existing.winner_team_id !== (input.winnerTeamId ?? null)
	) {
		throw new TournamentError('A completed series winner cannot be changed from game details.', 409);
	}

	const { error } = await admin.from('tournament_match_games').upsert(
		{
			match_id: match.id,
			game_number: input.gameNumber,
			map_id: input.mapId,
			map_picked_by_team_id: input.pickedByTeamId,
			winner_team_id: input.winnerTeamId || null,
			vod_url: input.vodUrl || null,
			notes: input.notes || null,
			updated_at: new Date().toISOString()
		},
		{ onConflict: 'match_id,game_number' }
	);
	if (error) throw new TournamentError('Could not save game details.', 500);

	if (match.status !== 'completed') {
		if (state.winnerTeamId) {
			await recordMatchResult(
				{
					matchId: match.id,
					scoreA: state.scoreA,
					scoreB: state.scoreB,
					winnerTeamId: state.winnerTeamId
				},
				actorId,
				role
			);
		} else {
			const { error: scoreError } = await admin
				.from('tournament_matches')
				.update({ score_a: state.scoreA, score_b: state.scoreB })
				.eq('id', match.id);
			if (scoreError) throw new TournamentError('Could not update series score.', 500);
		}
	}
	return state;
}

export async function saveTournamentGameLineup(
	input: z.infer<typeof lineupSchema>,
	actorId: string,
	role: string
) {
	const admin = requireAdminClient();
	const { data: game } = await admin
		.from('tournament_match_games')
		.select('id, match_id')
		.eq('id', input.gameId)
		.maybeSingle<{ id: string; match_id: string }>();
	if (!game) throw new TournamentError('Game not found.', 404);
	const { data: match } = await admin
		.from('tournament_matches')
		.select('id, tournament_id, team_a_id, team_b_id')
		.eq('id', game.match_id)
		.maybeSingle<Pick<MatchRow, 'id' | 'tournament_id' | 'team_a_id' | 'team_b_id'>>();
	if (!match) throw new TournamentError('Match not found.', 404);
	const tournament = await getTournament(match.tournament_id);
	const isManager = canManageTournament(tournament, actorId, role);
	if (input.userId !== actorId && !isManager) {
		throw new TournamentError('You can only submit your own vehicle and build.', 403);
	}
	if (!isManager && tournament.status === 'completed') {
		throw new TournamentError('Tournament lineup submissions are closed.', 409);
	}
	const { data: roster } = await admin
		.from('tournament_roster_members')
		.select('team_id')
		.eq('tournament_id', tournament.id)
		.eq('user_id', input.userId)
		.maybeSingle<{ team_id: string }>();
	if (!roster || (roster.team_id !== match.team_a_id && roster.team_id !== match.team_b_id)) {
		throw new TournamentError('Player is not on a team in this match.', 409);
	}
	if (!input.vehicleId) {
		const { error } = await admin
			.from('tournament_game_lineups')
			.delete()
			.eq('game_id', game.id)
			.eq('user_id', input.userId);
		if (error) throw new TournamentError('Could not clear game loadout.', 500);
		return;
	}
	const vehicleExists = getGameDataBundle().vehicles.some(
		(vehicle) => vehicle.id === input.vehicleId && vehicle.selectable && !vehicle.isWorkInProgress
	);
	if (!vehicleExists) throw new TournamentError('Select a valid vehicle.', 400);
	if (input.buildSubmissionId) {
		const { data: submission } = await admin
			.from('tournament_build_submissions')
			.select('id, tournament_id, user_id, vehicle_id')
			.eq('id', input.buildSubmissionId)
			.maybeSingle<Pick<BuildSubmissionRow, 'id' | 'tournament_id' | 'user_id' | 'vehicle_id'>>();
		if (
			!submission ||
			submission.tournament_id !== tournament.id ||
			submission.user_id !== input.userId ||
			submission.vehicle_id !== input.vehicleId
		) {
			throw new TournamentError('Submitted build must belong to this player and vehicle.', 400);
		}
	}
	const { error } = await admin.from('tournament_game_lineups').upsert(
		{
			game_id: game.id,
			team_id: roster.team_id,
			user_id: input.userId,
			vehicle_id: input.vehicleId,
			build_submission_id: input.buildSubmissionId || null,
			submitted_by: actorId,
			updated_at: new Date().toISOString()
		},
		{ onConflict: 'game_id,user_id' }
	);
	if (error) throw new TournamentError('Could not save game loadout.', 500);
}
