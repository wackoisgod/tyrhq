import { describe, expect, it } from 'vitest';

import {
	summarizePlayerCompetition,
	type PlayerCompetitionEntryInput,
	type PlayerCompetitionGame,
	type PlayerCompetitionMatch
} from './player-profiles';

function match(
	id: string,
	tournamentId: string,
	round: number,
	teamA: string,
	teamB: string,
	scoreA: number,
	scoreB: number,
	winner: string
): PlayerCompetitionMatch {
	return {
		id,
		tournament_id: tournamentId,
		round,
		team_a_id: teamA,
		team_b_id: teamB,
		score_a: scoreA,
		score_b: scoreB,
		winner_team_id: winner,
		status: 'completed'
	};
}

function game(
	id: string,
	matchId: string,
	teamId: string,
	winnerTeamId: string | null
): PlayerCompetitionGame {
	return {
		id,
		match_id: matchId,
		team_id: teamId,
		winner_team_id: winnerTeamId
	};
}

function entry(
	id: string,
	status: PlayerCompetitionEntryInput['tournament']['status'],
	teamId: string,
	matches: PlayerCompetitionMatch[],
	games: PlayerCompetitionGame[],
	startsAt: string
): PlayerCompetitionEntryInput {
	return {
		tournament: {
			id,
			slug: id,
			name: `Tournament ${id}`,
			logoUrl: null,
			startsAt,
			status
		},
		team: {
			id: teamId,
			slug: `team-${teamId}`,
			name: `Team ${teamId}`,
			logoUrl: null,
			isDisabled: false
		},
		source: 'team',
		joinedAt: startsAt,
		seed: 1,
		registrationStatus: 'checked_in',
		matches,
		games
	};
}

describe('summarizePlayerCompetition', () => {
	it('counts roster-wide series and participation-only games', () => {
		const firstMatches = [
			match('alpha-semi-a', 'alpha', 1, 'a', 'd', 3, 1, 'a'),
			match('alpha-semi-b', 'alpha', 1, 'b', 'c', 3, 2, 'b'),
			match('alpha-final', 'alpha', 2, 'a', 'b', 2, 4, 'b')
		];
		const firstGames = [
			game('alpha-game-1', 'alpha-semi-a', 'a', 'a'),
			game('alpha-game-2', 'alpha-semi-a', 'a', 'd')
		];
		const secondMatches = [match('bravo-final', 'bravo', 1, 'a', 'c', 4, 0, 'a')];
		const secondGames = [game('bravo-game-1', 'bravo-final', 'a', 'a')];

		const result = summarizePlayerCompetition([
			entry('alpha', 'completed', 'a', firstMatches, firstGames, '2026-06-01T00:00:00.000Z'),
			entry('bravo', 'completed', 'a', secondMatches, secondGames, '2026-07-01T00:00:00.000Z'),
			entry('charlie', 'open', 'a', [], [], '2026-08-01T00:00:00.000Z')
		]);

		expect(result.stats).toEqual({
			tournamentsPlayed: 2,
			titles: 1,
			topFourFinishes: 2,
			seriesWins: 2,
			seriesLosses: 1,
			gameWins: 2,
			gameLosses: 1,
			seriesAppearances: 3,
			gameAppearances: 3
		});
		expect(result.history.map((history) => history.tournament.id)).toEqual([
			'charlie',
			'bravo',
			'alpha'
		]);
		expect(result.history[2]?.finish).toMatchObject({
			tier: 'runner_up',
			placementLabel: '2nd place'
		});
		expect(result.history[2]?.record).toEqual({
			seriesWins: 1,
			seriesLosses: 1,
			gameWins: 1,
			gameLosses: 1,
			seriesAppearances: 2,
			gameAppearances: 2
		});
	});

	it('credits a benched roster member with the team series but no game record', () => {
		const result = summarizePlayerCompetition([
			entry(
				'champion',
				'completed',
				'a',
				[match('champion-final', 'champion', 1, 'a', 'b', 4, 1, 'a')],
				[],
				'2026-07-01T00:00:00.000Z'
			)
		]);

		expect(result.history[0]?.finish.tier).toBe('champion');
		expect(result.history[0]?.record).toEqual({
			seriesWins: 1,
			seriesLosses: 0,
			gameWins: 0,
			gameLosses: 0,
			seriesAppearances: 1,
			gameAppearances: 0
		});
		expect(result.stats).toEqual({
			tournamentsPlayed: 1,
			titles: 1,
			topFourFinishes: 1,
			seriesWins: 1,
			seriesLosses: 0,
			gameWins: 0,
			gameLosses: 0,
			seriesAppearances: 1,
			gameAppearances: 0
		});
	});

	it('keeps cancelled history visible without adding it to career totals', () => {
		const cancelledMatch = match('cancelled-final', 'cancelled', 1, 'a', 'b', 3, 0, 'a');
		const result = summarizePlayerCompetition([
			entry(
				'cancelled',
				'cancelled',
				'a',
				[cancelledMatch],
				[game('cancelled-game', cancelledMatch.id, 'a', 'a')],
				'2026-07-01T00:00:00.000Z'
			)
		]);

		expect(result.history).toHaveLength(1);
		expect(result.history[0]?.finish.tier).toBe('cancelled');
		expect(result.stats).toEqual({
			tournamentsPlayed: 0,
			titles: 0,
			topFourFinishes: 0,
			seriesWins: 0,
			seriesLosses: 0,
			gameWins: 0,
			gameLosses: 0,
			seriesAppearances: 0,
			gameAppearances: 0
		});
	});
});
