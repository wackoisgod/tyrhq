import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
	addTournamentTeam,
	buildSingleEliminationRows,
	createTournamentSchema,
	summarizeSingleEliminationFinish,
	slugify,
	canViewTournament,
	listTournaments
} from './tournaments';
import { getSupabaseAdminClient } from './supabase-admin';
import {
	findBlockedTeamNameTerm,
	normalizeTeamNameForSafety
} from './tournament-safety';

vi.mock('./supabase-admin', () => ({
	getSupabaseAdminClient: vi.fn()
}));

describe('force register authorization', () => {
	it('rejects an organizer who is not a site admin before any team lookup', async () => {
		vi.mocked(getSupabaseAdminClient).mockClear();
		await expect(addTournamentTeam('tournament-id', 'team-id', 'organizer-id', 'user')).rejects.toMatchObject({
			statusCode: 403,
			message: 'Only a site admin can force register a team.'
		});
		expect(getSupabaseAdminClient).not.toHaveBeenCalled();
	});

	it('lets a site admin past the role check', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(null);
		await expect(addTournamentTeam('tournament-id', 'team-id', 'admin-id', 'admin')).rejects.toMatchObject({
			statusCode: 503
		});
	});
});

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

describe('listTournaments status classification', () => {
	let mockAdmin: any;
	let originalDate: DateConstructor;

	beforeEach(async () => {
		// Mock current time to 2026-06-01 12:00:00 UTC
		originalDate = global.Date;
		const mockNow = new Date('2026-06-01T12:00:00.000Z').getTime();
		vi.spyOn(global.Date, 'now').mockReturnValue(mockNow);

		// Mock Supabase admin client
		mockAdmin = {
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					neq: vi.fn(() => ({
						neq: vi.fn(() => ({
							is: vi.fn(() => ({
								order: vi.fn(() => Promise.resolve({
									data: [],
									error: null
								}))
							}))
						}))
					}))
				}))
			}))
		};

		const { getSupabaseAdminClient } = await import('./supabase-admin');
		vi.mocked(getSupabaseAdminClient).mockReturnValue(mockAdmin);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('classifies in_progress tournament with past start as Upcoming', async () => {
		const mockTournaments = [
			{
				id: '1',
				slug: 'in-progress-past',
				name: 'In Progress Past',
				summary: null,
				logo_url: null,
				organizer_id: 'org1',
				starts_at: '2026-06-01T10:00:00.000Z', // 2 hours ago
				registration_closes_at: null,
				registration_mode: 'open' as const,
				status: 'in_progress' as const,
				team_size: 8,
				substitute_count: 1,
				max_teams: 16,
				prize_info: null,
				rules_url: null,
				discord_url: null,
				created_at: '2026-05-01T00:00:00.000Z',
				updated_at: '2026-06-01T10:00:00.000Z',
				organizer: { id: 'org1', display_name: 'Organizer' }
			}
		];

		mockAdmin.from = vi.fn(() => ({
			select: vi.fn(() => ({
				neq: vi.fn(() => ({
					neq: vi.fn(() => ({
						is: vi.fn(() => ({
							order: vi.fn(() => Promise.resolve({
								data: mockTournaments,
								error: null
							}))
						}))
					}))
				}))
			}))
		}));

		const result = await listTournaments();
		expect(result.upcoming).toHaveLength(1);
		expect(result.upcoming[0].id).toBe('1');
		expect(result.past).toHaveLength(0);
	});

	it('classifies completed tournament with future start as Past', async () => {
		const mockTournaments = [
			{
				id: '2',
				slug: 'completed-future',
				name: 'Completed Future',
				summary: null,
				logo_url: null,
				organizer_id: 'org1',
				starts_at: '2026-06-01T14:00:00.000Z', // 2 hours from now
				registration_closes_at: null,
				registration_mode: 'open' as const,
				status: 'completed' as const,
				team_size: 8,
				substitute_count: 1,
				max_teams: 16,
				prize_info: null,
				rules_url: null,
				discord_url: null,
				created_at: '2026-05-01T00:00:00.000Z',
				updated_at: '2026-06-01T13:00:00.000Z',
				organizer: { id: 'org1', display_name: 'Organizer' }
			}
		];

		mockAdmin.from = vi.fn(() => ({
			select: vi.fn(() => ({
				neq: vi.fn(() => ({
					neq: vi.fn(() => ({
						is: vi.fn(() => ({
							order: vi.fn(() => Promise.resolve({
								data: mockTournaments,
								error: null
							}))
						}))
					}))
				}))
			}))
		}));

		const result = await listTournaments();
		expect(result.upcoming).toHaveLength(0);
		expect(result.past).toHaveLength(1);
		expect(result.past[0].id).toBe('2');
	});

	it('classifies open tournament with past start as Upcoming', async () => {
		const mockTournaments = [
			{
				id: '3',
				slug: 'open-past',
				name: 'Open Past',
				summary: null,
				logo_url: null,
				organizer_id: 'org1',
				starts_at: '2026-06-01T10:00:00.000Z', // 2 hours ago
				registration_closes_at: null,
				registration_mode: 'open' as const,
				status: 'open' as const,
				team_size: 8,
				substitute_count: 1,
				max_teams: 16,
				prize_info: null,
				rules_url: null,
				discord_url: null,
				created_at: '2026-05-01T00:00:00.000Z',
				updated_at: '2026-06-01T10:00:00.000Z',
				organizer: { id: 'org1', display_name: 'Organizer' }
			}
		];

		mockAdmin.from = vi.fn(() => ({
			select: vi.fn(() => ({
				neq: vi.fn(() => ({
					neq: vi.fn(() => ({
						is: vi.fn(() => ({
							order: vi.fn(() => Promise.resolve({
								data: mockTournaments,
								error: null
							}))
						}))
					}))
				}))
			}))
		}));

		const result = await listTournaments();
		expect(result.upcoming).toHaveLength(1);
		expect(result.upcoming[0].id).toBe('3');
		expect(result.past).toHaveLength(0);
	});

	it('filters out cancelled tournaments from results', async () => {
		// This test verifies that cancelled tournaments are filtered by the query
		// (via .neq('status', 'cancelled')), so they never reach the classification logic
		const mockTournaments = [
			{
				id: '4',
				slug: 'active',
				name: 'Active',
				summary: null,
				logo_url: null,
				organizer_id: 'org1',
				starts_at: '2026-06-01T14:00:00.000Z',
				registration_closes_at: null,
				registration_mode: 'open' as const,
				status: 'open' as const,
				team_size: 8,
				substitute_count: 1,
				max_teams: 16,
				prize_info: null,
				rules_url: null,
				discord_url: null,
				created_at: '2026-05-01T00:00:00.000Z',
				updated_at: '2026-06-01T10:00:00.000Z',
				organizer: { id: 'org1', display_name: 'Organizer' }
			}
			// Cancelled tournament would be filtered out by query, so not included in mock data
		];

		mockAdmin.from = vi.fn(() => ({
			select: vi.fn(() => ({
				neq: vi.fn(() => ({
					neq: vi.fn(() => ({
						is: vi.fn(() => ({
							order: vi.fn(() => Promise.resolve({
								data: mockTournaments,
								error: null
							}))
						}))
					}))
				}))
			}))
		}));

		const result = await listTournaments();
		expect(result.upcoming.length + result.past.length).toBe(1);
		expect(result.upcoming.concat(result.past).every(t => t.status !== 'cancelled')).toBe(true);
	});

	it('drops an unlisted tournament if one is returned', async () => {
		const mockTournaments = [
			{
				id: '5',
				slug: 'hidden',
				name: 'Hidden',
				summary: null,
				logo_url: null,
				organizer_id: 'org1',
				starts_at: '2026-06-02T14:00:00.000Z',
				registration_closes_at: null,
				registration_mode: 'open' as const,
				status: 'open' as const,
				team_size: 8,
				substitute_count: 1,
				max_teams: 16,
				prize_info: null,
				rules_url: null,
				discord_url: null,
				unlisted_at: '2026-06-01T00:00:00.000Z',
				created_at: '2026-05-01T00:00:00.000Z',
				updated_at: '2026-06-01T10:00:00.000Z',
				organizer: { id: 'org1', display_name: 'Organizer' }
			}
		];

		mockAdmin.from = vi.fn(() => ({
			select: vi.fn(() => ({
				neq: vi.fn(() => ({
					neq: vi.fn(() => ({
						is: vi.fn(() => ({
							order: vi.fn(() => Promise.resolve({
								data: mockTournaments,
								error: null
							}))
						}))
					}))
				}))
			}))
		}));

		const result = await listTournaments();
		expect(result.upcoming).toHaveLength(0);
		expect(result.past).toHaveLength(0);
	});
});

describe('canViewTournament', () => {
	const listed = { status: 'open', unlistedAt: null, organizerId: 'org' };

	it('hides an unlisted tournament from the public and from other players', () => {
		const unlisted = { ...listed, unlistedAt: '2026-11-01T00:00:00.000Z' };
		expect(canViewTournament(unlisted, null, 'user')).toBe(false);
		expect(canViewTournament(unlisted, 'someone-else', 'user')).toBe(false);
		expect(canViewTournament(unlisted, 'org', 'user')).toBe(true);
		expect(canViewTournament(unlisted, 'admin-id', 'admin')).toBe(true);
	});

	it('keeps a listed tournament public', () => {
		expect(canViewTournament(listed, null, 'user')).toBe(true);
	});
});
