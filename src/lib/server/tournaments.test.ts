import { describe, expect, it } from 'vitest';

import {
	buildSingleEliminationRows,
	createTournamentSchema,
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

		expect(rows).toHaveLength(3);
		expect(rows.filter((row) => row.round === 1)).toHaveLength(2);
		expect(rows.filter((row) => row.round === 2)).toHaveLength(1);
		expect(rows[1]).toMatchObject({
			team_a_id: 'c',
			team_b_id: null,
			winner_team_id: 'c',
			status: 'completed'
		});
	});

	it('keeps slug generation URL-safe', () => {
		expect(slugify(' Sunday Cup: NA #1 ')).toBe('sunday-cup-na-1');
	});
});
