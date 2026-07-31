import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseAdminClient } from './supabase-admin';
import {
	summarizeSingleEliminationFinish,
	TournamentError,
	type TournamentFinish
} from './tournaments';

type TournamentStatus = 'draft' | 'open' | 'in_progress' | 'completed' | 'cancelled';

interface ProfileRow {
	id: string;
	display_name: string | null;
}

interface TeamRef {
	id: string;
	slug: string;
	name: string;
	logo_url: string | null;
	is_disabled: boolean;
}

interface TournamentRef {
	id: string;
	slug: string;
	name: string;
	logo_url: string | null;
	starts_at: string;
	status: TournamentStatus;
}

interface MembershipRow {
	role: 'captain' | 'member';
	joined_at: string;
	team?: TeamRef | TeamRef[] | null;
}

interface RosterRow {
	tournament_id: string;
	team_id: string;
	source: 'team' | 'free_agent';
	joined_at: string;
	tournament?: TournamentRef | TournamentRef[] | null;
	team?: TeamRef | TeamRef[] | null;
}

interface RegistrationRow {
	tournament_id: string;
	team_id: string;
	status: 'registered' | 'checked_in' | 'withdrawn';
	seed: number | null;
}

interface PlayerLineupRow {
	game_id: string;
	team_id: string;
}

interface MatchGameRow {
	id: string;
	match_id: string;
	winner_team_id: string | null;
}

export interface PlayerCompetitionMatch {
	id: string;
	tournament_id: string;
	round: number;
	team_a_id: string | null;
	team_b_id: string | null;
	score_a: number;
	score_b: number;
	winner_team_id: string | null;
	status: 'pending' | 'completed';
}

export interface PlayerCompetitionGame {
	id: string;
	match_id: string;
	team_id: string;
	winner_team_id: string | null;
}

export interface PlayerCompetitionEntryInput {
	tournament: {
		id: string;
		slug: string;
		name: string;
		logoUrl: string | null;
		startsAt: string;
		status: TournamentStatus;
	};
	team: {
		id: string;
		slug: string;
		name: string;
		logoUrl: string | null;
		isDisabled: boolean;
	};
	source: 'team' | 'free_agent';
	joinedAt: string;
	seed: number | null;
	registrationStatus: 'registered' | 'checked_in' | null;
	matches: PlayerCompetitionMatch[];
	games: PlayerCompetitionGame[];
}

export interface CompetitionRecord {
	seriesWins: number;
	seriesLosses: number;
	gameWins: number;
	gameLosses: number;
	seriesAppearances: number;
	gameAppearances: number;
}

export interface PlayerCompetitionHistoryEntry extends Omit<PlayerCompetitionEntryInput, 'matches' | 'games'> {
	finish: TournamentFinish;
	record: CompetitionRecord;
}

export interface PlayerCareerStats extends CompetitionRecord {
	tournamentsPlayed: number;
	titles: number;
	topFourFinishes: number;
}

function one<T>(value: T | T[] | null | undefined): T | null {
	return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function requireAdminClient(): SupabaseClient {
	const admin = getSupabaseAdminClient();
	if (!admin) throw new TournamentError('Player profiles require SUPABASE_SERVICE_ROLE_KEY.', 503);
	return admin;
}

function recordForPlayer(
	teamId: string,
	matches: PlayerCompetitionMatch[],
	games: PlayerCompetitionGame[]
): CompetitionRecord {
	const record: CompetitionRecord = {
		seriesWins: 0,
		seriesLosses: 0,
		gameWins: 0,
		gameLosses: 0,
		seriesAppearances: 0,
		gameAppearances: 0
	};
	const playerGames = games.filter((game) => game.team_id === teamId);
	record.gameAppearances = playerGames.length;

	for (const game of playerGames) {
		if (!game.winner_team_id) continue;
		if (game.winner_team_id === teamId) record.gameWins++;
		else record.gameLosses++;
	}

	for (const match of matches) {
		if (
			match.status !== 'completed' ||
			!match.winner_team_id ||
			(match.team_a_id !== teamId && match.team_b_id !== teamId)
		) {
			continue;
		}

		if (match.winner_team_id === teamId) record.seriesWins++;
		else record.seriesLosses++;
	}
	record.seriesAppearances = record.seriesWins + record.seriesLosses;

	return record;
}

export function summarizePlayerCompetition(entries: PlayerCompetitionEntryInput[]) {
	const history: PlayerCompetitionHistoryEntry[] = entries
		.map((entry) => ({
			...entry,
			finish: summarizeSingleEliminationFinish(
				entry.team.id,
				entry.tournament.status,
				entry.matches
			),
			record: recordForPlayer(entry.team.id, entry.matches, entry.games)
		}))
		.sort(
			(a, b) =>
				new Date(b.tournament.startsAt).getTime() - new Date(a.tournament.startsAt).getTime()
		);

	const countedHistory = history.filter((entry) => entry.tournament.status !== 'cancelled');
	const stats = countedHistory.reduce<PlayerCareerStats>(
		(total, entry) => {
			total.seriesWins += entry.record.seriesWins;
			total.seriesLosses += entry.record.seriesLosses;
			total.gameWins += entry.record.gameWins;
			total.gameLosses += entry.record.gameLosses;
			total.seriesAppearances += entry.record.seriesAppearances;
			total.gameAppearances += entry.record.gameAppearances;
			if (entry.record.seriesAppearances > 0) total.tournamentsPlayed++;
			if (entry.tournament.status === 'completed' && entry.finish.tier === 'champion') {
				total.titles++;
			}
			if (
				entry.tournament.status === 'completed' &&
				entry.finish.placementStart !== null &&
				entry.finish.placementStart <= 4
			) {
				total.topFourFinishes++;
			}
			return total;
		},
		{
			tournamentsPlayed: 0,
			titles: 0,
			topFourFinishes: 0,
			seriesWins: 0,
			seriesLosses: 0,
			gameWins: 0,
			gameLosses: 0,
			seriesAppearances: 0,
			gameAppearances: 0
		}
	);

	return { history, stats };
}

export async function getPlayerCompetitionProfile(userId: string) {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
		return null;
	}

	const admin = requireAdminClient();
	const [profileResult, membershipResult, rosterResult] = await Promise.all([
		admin.from('profiles').select('id, display_name').eq('id', userId).maybeSingle<ProfileRow>(),
		admin
			.from('team_members')
			.select('role, joined_at, team:teams(id, slug, name, logo_url, is_disabled)')
			.eq('user_id', userId)
			.order('joined_at', { ascending: false }),
		admin
			.from('tournament_roster_members')
			.select(
				'tournament_id, team_id, source, joined_at, tournament:tournaments(id, slug, name, logo_url, starts_at, status), team:teams(id, slug, name, logo_url, is_disabled)'
			)
			.eq('user_id', userId)
			.order('joined_at', { ascending: false })
	]);

	if (profileResult.error) throw new TournamentError('Could not load player profile.', 500);
	if (!profileResult.data) return null;
	if (membershipResult.error) throw new TournamentError('Could not load player teams.', 500);
	if (rosterResult.error) throw new TournamentError('Could not load player tournament history.', 500);

	const currentTeams = ((membershipResult.data as MembershipRow[] | null) ?? [])
		.map((membership) => {
			const team = one(membership.team);
			return team && !team.is_disabled
				? {
						id: team.id,
						slug: team.slug,
						name: team.name,
						logoUrl: team.logo_url,
						role: membership.role,
						joinedAt: membership.joined_at
					}
				: null;
		})
		.filter((team): team is NonNullable<typeof team> => team !== null);

	const publicRoster = ((rosterResult.data as RosterRow[] | null) ?? []).filter(
		(row) => one(row.tournament)?.status !== 'draft'
	);
	const tournamentIds = [...new Set(publicRoster.map((row) => row.tournament_id))];
	let registrations: RegistrationRow[] = [];
	let matches: PlayerCompetitionMatch[] = [];
	let games: PlayerCompetitionGame[] = [];

	if (tournamentIds.length > 0) {
		const [registrationResult, matchResult, lineupResult] = await Promise.all([
			admin
				.from('tournament_registrations')
				.select('tournament_id, team_id, status, seed')
				.in('tournament_id', tournamentIds)
				.neq('status', 'withdrawn'),
			admin
				.from('tournament_matches')
				.select(
					'id, tournament_id, round, team_a_id, team_b_id, score_a, score_b, winner_team_id, status'
				)
				.in('tournament_id', tournamentIds),
			admin
				.from('tournament_game_lineups')
				.select('game_id, team_id')
				.eq('user_id', userId)
		]);
		if (registrationResult.error) {
			throw new TournamentError('Could not load player tournament registrations.', 500);
		}
		if (matchResult.error) throw new TournamentError('Could not load player match record.', 500);
		if (lineupResult.error) throw new TournamentError('Could not load player game appearances.', 500);
		registrations = (registrationResult.data as RegistrationRow[] | null) ?? [];
		matches = (matchResult.data as PlayerCompetitionMatch[] | null) ?? [];

		const lineups = (lineupResult.data as PlayerLineupRow[] | null) ?? [];
		const gameIds = [...new Set(lineups.map((lineup) => lineup.game_id))];
		if (gameIds.length > 0) {
			const { data: gameData, error: gameError } = await admin
				.from('tournament_match_games')
				.select('id, match_id, winner_team_id')
				.in('id', gameIds);
			if (gameError) throw new TournamentError('Could not load player game results.', 500);
			const lineupByGame = new Map(lineups.map((lineup) => [lineup.game_id, lineup]));
			const publicMatchIds = new Set(matches.map((match) => match.id));
			games = ((gameData as MatchGameRow[] | null) ?? []).flatMap((game) => {
				const lineup = lineupByGame.get(game.id);
				return lineup && publicMatchIds.has(game.match_id)
					? [{ ...game, team_id: lineup.team_id }]
					: [];
			});
		}
	}

	const registrationsByEntry = new Map(
		registrations.map((registration) => [
			`${registration.tournament_id}:${registration.team_id}`,
			registration
		])
	);
	const matchesByTournament = new Map<string, PlayerCompetitionMatch[]>();
	const tournamentByMatch = new Map<string, string>();
	for (const match of matches) {
		const tournamentMatches = matchesByTournament.get(match.tournament_id) ?? [];
		tournamentMatches.push(match);
		matchesByTournament.set(match.tournament_id, tournamentMatches);
		tournamentByMatch.set(match.id, match.tournament_id);
	}
	const gamesByTournament = new Map<string, PlayerCompetitionGame[]>();
	for (const game of games) {
		const tournamentId = tournamentByMatch.get(game.match_id);
		if (!tournamentId) continue;
		const tournamentGames = gamesByTournament.get(tournamentId) ?? [];
		tournamentGames.push(game);
		gamesByTournament.set(tournamentId, tournamentGames);
	}

	const entries = publicRoster.flatMap<PlayerCompetitionEntryInput>((row) => {
		const tournament = one(row.tournament);
		const team = one(row.team);
		if (!tournament || !team) return [];
		const registration = registrationsByEntry.get(`${row.tournament_id}:${row.team_id}`);
		return [
			{
				tournament: {
					id: tournament.id,
					slug: tournament.slug,
					name: tournament.name,
					logoUrl: tournament.logo_url,
					startsAt: tournament.starts_at,
					status: tournament.status
				},
				team: {
					id: team.id,
					slug: team.slug,
					name: team.name,
					logoUrl: team.logo_url,
					isDisabled: team.is_disabled
				},
				source: row.source,
				joinedAt: row.joined_at,
				seed: registration?.seed ?? null,
				registrationStatus:
					registration?.status === 'registered' || registration?.status === 'checked_in'
						? registration.status
						: null,
				matches: matchesByTournament.get(row.tournament_id) ?? [],
				games: gamesByTournament.get(row.tournament_id) ?? []
			}
		];
	});
	const competition = summarizePlayerCompetition(entries);

	return {
		id: profileResult.data.id,
		displayName: profileResult.data.display_name?.trim() || 'Unknown player',
		currentTeams,
		...competition
	};
}
