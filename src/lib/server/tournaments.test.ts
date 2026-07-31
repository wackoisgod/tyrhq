import { describe, expect, it } from 'vitest';

import {
	buildSingleEliminationRows,
	createTournamentSchema,
	summarizeSingleEliminationFinish,
	slugify
} from './tournaments';
import {
	findBlockedTeamNameTerm,
	normalizeTeamNameForSafety
} from './tournament-safety';

describe('team name safety', () => {
	it('normalizes punctuation and leetspeak before checking blocked terms', () => {
		expect(normalizeTeamNameForSafety('N@-z! Unit')).toBe('naziunit');
		expect(findBlockedTeamNameTerm('N@-z! Unit')).toBe('nazi');
	});

	it('allows ordinary competitive team names', () => {
		expect(findBlockedTeamNameTerm('North Ridge Armor')).toBeNull();
	});
});

describe('tournament validation', () => {
	it('requires Tyr tournaments to use 8v8 team size', () => {
		const parsed = createTournamentSchema.safeParse({
			name: 'Sunday Cup',
			startsAt: '2026-06-01T18:00:00.000Z',
			registrationMode: 'open',
			teamSize: 6,
			substituteCount: 1
		});

		expect(parsed.success).toBe(false);
	});

	it('rejects registration closing after tournament start', () => {
		const parsed = createTournamentSchema.safeParse({
			name: 'Sunday Cup',
			startsAt: '2026-06-01T18:00:00.000Z',
			registrationClosesAt: '2026-06-01T19:00:00.000Z',
			registrationMode: 'open',
			teamSize: 8,
			substituteCount: 1
		});

		expect(parsed.success).toBe(false);
	});
});

describe('bracket generation', () => {
	it('builds a complete single-elimination scaffold with byes', () => {
		const rows = buildSingleEliminationRows('tournament-id', ['a', 'b', 'c']);
		const firstRound = rows.filter((row) => row.round === 1);
		const final = rows.find((row) => row.round === 2);

		expect(rows).toHaveLength(3);
		expect(firstRound).toHaveLength(2);
		expect(firstRound[0]).toMatchObject({
			team_a_id: 'a',
			team_b_id: null,
			best_of: 5,
			winner_team_id: 'a',
			status: 'completed'
		});
		expect(firstRound[1]).toMatchObject({
			team_a_id: 'b',
			team_b_id: 'c',
			status: 'pending'
		});
		expect(final).toMatchObject({ team_a_id: 'a', best_of: 7 });
	});

	it('gives the highest seeds byes without empty matches or stalled paths', () => {
		const rows = buildSingleEliminationRows('tournament-id', ['a', 'b', 'c', 'd', 'e']);
		const firstRound = rows.filter((row) => row.round === 1);
		const secondRound = rows.filter((row) => row.round === 2);

		expect(firstRound).toHaveLength(4);
		expect(firstRound.every((row) => row.team_a_id || row.team_b_id)).toBe(true);
		expect(firstRound.filter((row) => row.status === 'completed')).toHaveLength(3);
		expect(firstRound.map((row) => [row.team_a_id, row.team_b_id])).toEqual([
			['a', null],
			['d', 'e'],
			['b', null],
			['c', null]
		]);
		expect(secondRound[0]).toMatchObject({ team_a_id: 'a' });
		expect(secondRound[1]).toMatchObject({ team_a_id: 'b', team_b_id: 'c' });
	});

	it('places eight ranked teams in a standard snake bracket', () => {
		const rows = buildSingleEliminationRows('tournament-id', [
			'seed-1',
			'seed-2',
			'seed-3',
			'seed-4',
			'seed-5',
			'seed-6',
			'seed-7',
			'seed-8'
		]);
		const firstRound = rows.filter((row) => row.round === 1);

		expect(firstRound.map((row) => [row.team_a_id, row.team_b_id])).toEqual([
			['seed-1', 'seed-8'],
			['seed-4', 'seed-5'],
			['seed-2', 'seed-7'],
			['seed-3', 'seed-6']
		]);
		expect(firstRound.every((row) => row.best_of === 5)).toBe(true);
		expect(rows.find((row) => row.round === 3)?.best_of).toBe(7);
	});

	it('recursively preserves snake placement for sixteen teams', () => {
		const teams = Array.from({ length: 16 }, (_, index) => `seed-${index + 1}`);
		const rows = buildSingleEliminationRows('tournament-id', teams);
		const firstRound = rows.filter((row) => row.round === 1);

		expect(firstRound.map((row) => [row.team_a_id, row.team_b_id])).toEqual([
			['seed-1', 'seed-16'],
			['seed-8', 'seed-9'],
			['seed-4', 'seed-13'],
			['seed-5', 'seed-12'],
			['seed-2', 'seed-15'],
			['seed-7', 'seed-10'],
			['seed-3', 'seed-14'],
			['seed-6', 'seed-11']
		]);
	});

	it('rejects regeneration before producing rows when fewer than two teams are registered', () => {
		expect(() => buildSingleEliminationRows('tournament-id', ['a'])).toThrow(
			'At least two teams are required.'
		);
	});

	it('keeps slug generation URL-safe', () => {
		expect(slugify(' Sunday Cup: NA #1 ')).toBe('sunday-cup-na-1');
	});

	it('reports exact champion and runner-up finishes', () => {
		const matches = [
			{ round: 1, team_a_id: 'a', team_b_id: 'd', winner_team_id: 'a', status: 'completed' as const },
			{ round: 1, team_a_id: 'b', team_b_id: 'c', winner_team_id: 'b', status: 'completed' as const },
			{ round: 2, team_a_id: 'a', team_b_id: 'b', winner_team_id: 'a', status: 'completed' as const }
		];

		expect(summarizeSingleEliminationFinish('a', 'completed', matches)).toMatchObject({
			tier: 'champion',
			placementLabel: '1st place',
			wins: 2,
			losses: 0
		});
		expect(summarizeSingleEliminationFinish('b', 'completed', matches)).toMatchObject({
			tier: 'runner_up',
			placementLabel: '2nd place',
			wins: 1,
			losses: 1
		});
	});

	it('uses a placement range when no third-place match exists', () => {
		const matches = [
			{ round: 1, team_a_id: 'a', team_b_id: 'h', winner_team_id: 'a', status: 'completed' as const },
			{ round: 1, team_a_id: 'd', team_b_id: 'e', winner_team_id: 'd', status: 'completed' as const },
			{ round: 1, team_a_id: 'b', team_b_id: 'g', winner_team_id: 'b', status: 'completed' as const },
			{ round: 1, team_a_id: 'c', team_b_id: 'f', winner_team_id: 'c', status: 'completed' as const },
			{ round: 2, team_a_id: 'a', team_b_id: 'd', winner_team_id: 'a', status: 'completed' as const },
			{ round: 2, team_a_id: 'b', team_b_id: 'c', winner_team_id: 'b', status: 'completed' as const },
			{ round: 3, team_a_id: 'a', team_b_id: 'b', winner_team_id: 'a', status: 'completed' as const }
		];

		expect(summarizeSingleEliminationFinish('c', 'completed', matches)).toMatchObject({
			tier: 'semifinalist',
			placementLabel: '3rd–4th place',
			wins: 1,
			losses: 1
		});
		expect(summarizeSingleEliminationFinish('f', 'completed', matches)).toMatchObject({
			tier: 'quarterfinalist',
			placementLabel: '5th–8th place',
			wins: 0,
			losses: 1
		});
	});
});
