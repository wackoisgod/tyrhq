import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	ORGANIZER_REAPPLY_AFTER_MS,
	OrganizerApplicationError,
	assertApplicationEligibility,
	reviewOrganizerApplication,
	revokeOrganizerAccess,
	submitOrganizerApplication,
	unlistTournament
} from './organizer-applications';
import { getSupabaseAdminClient } from './supabase-admin';

vi.mock('./supabase-admin', () => ({
	getSupabaseAdminClient: vi.fn()
}));

const now = new Date('2026-11-24T12:00:00.000Z');

const validInput = {
	discordHandle: 'pilot#1234',
	pastEvents: 'https://example.com/last-cup',
	format: '8v8 single elimination',
	region: 'NA',
	frequency: 'Monthly',
	expectedPlayerCount: 64
};

type Call = {
	table: string;
	op: 'select' | 'insert' | 'update' | 'delete';
	payload?: unknown;
	filters: [string, string, unknown][];
};

function applicationRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 'app-1',
		user_id: 'user-1',
		discord_handle: validInput.discordHandle,
		past_events: validInput.pastEvents,
		event_format: validInput.format,
		region: validInput.region,
		frequency: validInput.frequency,
		expected_player_count: validInput.expectedPlayerCount,
		status: 'pending',
		review_note: null,
		reviewed_at: null,
		created_at: '2026-11-20T00:00:00.000Z',
		applicant: { display_name: 'Pilot' },
		...overrides
	};
}

function createAdmin(handle: (call: Call) => { data: unknown; error: unknown }) {
	const calls: Call[] = [];
	const client = {
		from(table: string) {
			let op: Call['op'] = 'select';
			let payload: unknown;
			const filters: Call['filters'] = [];
			const run = () => {
				const call: Call = { table, op, payload, filters: [...filters] };
				calls.push(call);
				return handle(call);
			};
			const builder = {
				select: () => builder,
				order: () => builder,
				limit: () => builder,
				eq: (column: string, value: unknown) => {
					filters.push(['eq', column, value]);
					return builder;
				},
				insert: (value: unknown) => {
					op = 'insert';
					payload = value;
					return builder;
				},
				update: (value: unknown) => {
					op = 'update';
					payload = value;
					return builder;
				},
				delete: () => {
					op = 'delete';
					return builder;
				},
				maybeSingle: () => Promise.resolve(run()),
				single: () => Promise.resolve(run())
			};
			return builder;
		},
		auth: {
			admin: {
				getUserById: async () => ({
					data: {
						user: {
							id: 'user-1',
							email: 'pilot@example.com',
							created_at: '2026-01-01T00:00:00.000Z',
							last_sign_in_at: null
						}
					}
				})
			}
		}
	};
	return { client, calls };
}

describe('organizer application eligibility', () => {
	it('requires a linked Steam account', () => {
		expect(() =>
			assertApplicationEligibility(
				{ steamLinked: false, isOrganizer: false, hasPending: false, latestRejectedAt: null },
				now
			)
		).toThrowError(/Steam/);
	});

	it('allows one pending application', () => {
		expect(() =>
			assertApplicationEligibility(
				{ steamLinked: true, isOrganizer: false, hasPending: true, latestRejectedAt: null },
				now
			)
		).toThrowError(expect.objectContaining({ statusCode: 409 }));
	});

	it('blocks a new application for 30 days after rejection', () => {
		const rejectedAt = new Date(now.getTime() - ORGANIZER_REAPPLY_AFTER_MS + 60_000).toISOString();
		expect(() =>
			assertApplicationEligibility(
				{ steamLinked: true, isOrganizer: false, hasPending: false, latestRejectedAt: rejectedAt },
				now
			)
		).toThrowError(expect.objectContaining({ statusCode: 429 }));
	});

	it('allows a new application once 30 days have passed', () => {
		const rejectedAt = new Date(now.getTime() - ORGANIZER_REAPPLY_AFTER_MS).toISOString();
		expect(() =>
			assertApplicationEligibility(
				{ steamLinked: true, isOrganizer: false, hasPending: false, latestRejectedAt: rejectedAt },
				now
			)
		).not.toThrow();
	});
});

describe('submitOrganizerApplication', () => {
	beforeEach(() => {
		vi.mocked(getSupabaseAdminClient).mockReset();
	});

	it('does not insert when Steam is not linked', async () => {
		const { client, calls } = createAdmin((call) => {
			if (call.table === 'profiles') {
				return { data: { verified_steam_id: null, is_tournament_organizer: false }, error: null };
			}
			return { data: null, error: null };
		});
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);

		await expect(submitOrganizerApplication('user-1', validInput, now)).rejects.toMatchObject({
			statusCode: 403
		});
		expect(calls.some((call) => call.op === 'insert')).toBe(false);
	});

	it('does not insert a second application while one is pending', async () => {
		const { client, calls } = createAdmin((call) => {
			if (call.table === 'profiles') {
				return { data: { verified_steam_id: '76561198000000000', is_tournament_organizer: false }, error: null };
			}
			return { data: { status: 'pending', reviewed_at: null }, error: null };
		});
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);

		await expect(submitOrganizerApplication('user-1', validInput, now)).rejects.toMatchObject({
			statusCode: 409
		});
		expect(calls.some((call) => call.op === 'insert')).toBe(false);
	});

	it('does not insert during the 30-day rejection window', async () => {
		const reviewedAt = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
		const { client, calls } = createAdmin((call) => {
			if (call.table === 'profiles') {
				return { data: { verified_steam_id: '76561198000000000', is_tournament_organizer: false }, error: null };
			}
			return { data: { status: 'rejected', reviewed_at: reviewedAt }, error: null };
		});
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);

		await expect(submitOrganizerApplication('user-1', validInput, now)).rejects.toBeInstanceOf(
			OrganizerApplicationError
		);
		expect(calls.some((call) => call.op === 'insert')).toBe(false);
	});

	it('inserts a pending application after the rejection window', async () => {
		const reviewedAt = new Date(now.getTime() - ORGANIZER_REAPPLY_AFTER_MS).toISOString();
		const { client, calls } = createAdmin((call) => {
			if (call.op === 'insert') return { data: applicationRow(), error: null };
			if (call.table === 'profiles') {
				return { data: { verified_steam_id: '76561198000000000', is_tournament_organizer: false }, error: null };
			}
			return { data: { status: 'rejected', reviewed_at: reviewedAt }, error: null };
		});
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);

		const created = await submitOrganizerApplication('user-1', validInput, now);
		expect(created.status).toBe('pending');
		const insert = calls.find((call) => call.op === 'insert');
		expect(insert?.payload).toMatchObject({ status: 'pending', user_id: 'user-1' });
	});
});

describe('organizer review permissions', () => {
	beforeEach(() => {
		vi.mocked(getSupabaseAdminClient).mockReset();
	});

	it('refuses a non-admin reviewer before reading the application', async () => {
		await expect(
			reviewOrganizerApplication('app-1', { id: 'admin-1', role: 'contributor' }, { decision: 'approve' })
		).rejects.toMatchObject({ statusCode: 403 });
		expect(getSupabaseAdminClient).not.toHaveBeenCalled();
	});

	it('approval grants organizer access and does not delete tournaments', async () => {
		const { client, calls } = createAdmin((call) => {
			if (call.op === 'delete') return { data: null, error: { message: 'should not delete' } };
			if (call.table === 'tournaments') return { data: null, error: { message: 'tournaments touched' } };
			if (call.table === 'profiles' && call.op === 'update') {
				return {
					data: { id: 'user-1', display_name: 'Pilot', role: 'user', is_tournament_organizer: true },
					error: null
				};
			}
			if (call.op === 'update') return { data: applicationRow({ status: 'approved' }), error: null };
			return { data: { id: 'app-1', user_id: 'user-1', status: 'pending' }, error: null };
		});
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);

		const reviewed = await reviewOrganizerApplication(
			'app-1',
			{ id: 'admin-1', role: 'admin' },
			{ decision: 'approve', note: 'Welcome.' }
		);
		expect(reviewed.status).toBe('approved');
		expect(calls.some((call) => call.table === 'profiles' && call.op === 'update' && (call.payload as { is_tournament_organizer: boolean }).is_tournament_organizer === true)).toBe(true);
		expect(calls.some((call) => call.op === 'delete' || call.table === 'tournaments')).toBe(false);
	});

	it('rejection records the decision without granting organizer access', async () => {
		const { client, calls } = createAdmin((call) => {
			if (call.op === 'update') return { data: applicationRow({ status: 'rejected', review_note: 'Not yet.' }), error: null };
			return { data: { id: 'app-1', user_id: 'user-1', status: 'pending' }, error: null };
		});
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);

		await reviewOrganizerApplication(
			'app-1',
			{ id: 'admin-1', role: 'admin' },
			{ decision: 'reject', note: 'Not yet.' }
		);
		expect(calls.some((call) => call.table === 'profiles')).toBe(false);
		expect(calls.find((call) => call.op === 'update')?.payload).toMatchObject({ status: 'rejected' });
	});

	it('does not grant organizer access when the application is no longer pending', async () => {
		const { client, calls } = createAdmin(() => ({
			data: { id: 'app-1', user_id: 'user-1', status: 'rejected' },
			error: null
		}));
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);

		await expect(
			reviewOrganizerApplication('app-1', { id: 'admin-1', role: 'admin' }, { decision: 'approve' })
		).rejects.toMatchObject({ statusCode: 409 });
		expect(calls.some((call) => call.op === 'update')).toBe(false);
	});
});

describe('revoke and unlist', () => {
	beforeEach(() => {
		vi.mocked(getSupabaseAdminClient).mockReset();
	});

	it('refuses a non-admin revoke', async () => {
		await expect(revokeOrganizerAccess('user-1', { role: 'contributor' })).rejects.toMatchObject({
			statusCode: 403
		});
		expect(getSupabaseAdminClient).not.toHaveBeenCalled();
	});

	it('revoke clears organizer access and leaves tournaments in place', async () => {
		const { client, calls } = createAdmin((call) => {
			if (call.table === 'tournaments' || call.op === 'delete') {
				return { data: null, error: { message: 'tournaments must stay' } };
			}
			return {
				data: { id: 'user-1', display_name: 'Pilot', role: 'user', is_tournament_organizer: false },
				error: null
			};
		});
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);

		const updated = await revokeOrganizerAccess('user-1', { role: 'admin' });
		expect(updated.isTournamentOrganizer).toBe(false);
		expect(calls.some((call) => call.table === 'tournaments' || call.op === 'delete')).toBe(false);
		expect(calls.find((call) => call.op === 'update')?.payload).toMatchObject({
			is_tournament_organizer: false
		});
	});

	it('refuses a non-admin unlist', async () => {
		await expect(unlistTournament('tournament-1', { id: 'user-1', role: 'user' })).rejects.toMatchObject({
			statusCode: 403
		});
		expect(getSupabaseAdminClient).not.toHaveBeenCalled();
	});

	it('unlist marks the tournament hidden without deleting it', async () => {
		const { client, calls } = createAdmin((call) => {
			if (call.op === 'delete') return { data: null, error: { message: 'deleted' } };
			if (call.op === 'update') return { data: { id: 'tournament-1' }, error: null };
			return { data: { id: 'tournament-1', unlisted_at: null }, error: null };
		});
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);

		const result = await unlistTournament('tournament-1', { id: 'admin-1', role: 'admin' }, 'Spam');
		expect(result.unlistedAt).toEqual(expect.any(String));
		expect(calls.find((call) => call.op === 'update')?.payload).toMatchObject({
			unlisted_by: 'admin-1',
			unlist_note: 'Spam'
		});
		expect(calls.some((call) => call.op === 'delete')).toBe(false);
	});
});
