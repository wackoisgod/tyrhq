import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reviewOrganizerApplication, revokeOrganizerAccess } from './organizer-applications';
import { sendEmail } from './email';
import { getSupabaseAdminClient } from './supabase-admin';
import {
	canReadNotification,
	createNotification,
	isDeliverableEmail,
	listMyNotifications,
	markAllNotificationsRead,
	markNotificationRead,
	notificationInsertRow,
	notificationReadPatch,
	notificationsForViewer,
	organizerApplicantNotice,
	type NotificationActor
} from './notifications';

vi.mock('./supabase-admin', () => ({
	getSupabaseAdminClient: vi.fn()
}));

vi.mock('./email', () => ({
	sendEmail: vi.fn(async () => ({ delivered: false, reason: 'not_configured' })),
	isTransactionalEmailConfigured: () => false
}));

const userId = '11111111-1111-4111-8111-111111111111';
const otherId = '33333333-3333-4333-8333-333333333333';
const noteId = '44444444-4444-4444-8444-444444444444';

const migrationSql = readFileSync(new URL('../../../supabase/migrations/035_notifications.sql', import.meta.url), 'utf8');

type Call = {
	table: string;
	op: 'select' | 'insert' | 'update';
	payload?: unknown;
	filters: [string, string, unknown][];
};

function createClient(
	handle: (call: Call) => { data: unknown; error: unknown; count?: number | null },
	email: string | null = 'pilot@example.com'
) {
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
				is: (column: string, value: unknown) => {
					filters.push(['is', column, value]);
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
				maybeSingle: () => Promise.resolve(run()),
				single: () => Promise.resolve(run()),
				then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
					Promise.resolve(run()).then(onFulfilled, onRejected)
			};
			return builder;
		},
		auth: {
			admin: {
				getUserById: async () => ({
					data: { user: email ? { id: userId, email } : null },
					error: null
				})
			}
		}
	};
	return { client, calls };
}

function storedNotice(payload: Record<string, unknown>) {
	return {
		id: noteId,
		user_id: payload.user_id,
		type: payload.type,
		title: payload.title,
		body: payload.body,
		link: payload.link ?? null,
		read_at: null,
		created_at: '2026-11-24T12:00:00.000Z'
	};
}

describe('notification create and read rules', () => {
	beforeEach(() => {
		vi.mocked(getSupabaseAdminClient).mockReset();
	});

	it('matches the migration: own rows, read-state updates, server inserts only', () => {
		expect(migrationSql).toMatch(/enable row level security/i);
		expect(migrationSql).toMatch(/auth\.uid\(\) = user_id/g);
		expect(migrationSql).toMatch(/for select/i);
		expect(migrationSql).toMatch(/for update/i);
		expect(migrationSql).not.toMatch(/for insert/i);
		expect(migrationSql).not.toMatch(/for delete/i);
		expect(migrationSql).toContain('grant select on table public.notifications to authenticated');
		expect(migrationSql).toContain('grant update (read_at) on table public.notifications to authenticated');
		expect(migrationSql).not.toMatch(/grant\s+(insert|delete)[^;]*to\s+authenticated/i);
		expect(migrationSql).toContain(
			'grant select, insert, update, delete on table public.notifications to service_role'
		);
		expect(migrationSql).toMatch(/notifications are created by the server/);
		expect(migrationSql).toMatch(/only read state can be updated/);
	});

	it('builds a server insert and leaves the notice unread', async () => {
		const row = notificationInsertRow({
			userId,
			type: 'organizer_application_approved',
			title: 'Organizer access approved',
			body: 'You can publish a tournament now.',
			link: '/tournaments/manage'
		});
		expect(row).toEqual({
			user_id: userId,
			type: 'organizer_application_approved',
			title: 'Organizer access approved',
			body: 'You can publish a tournament now.',
			link: '/tournaments/manage'
		});
		expect(row).not.toHaveProperty('read_at');

		const { client, calls } = createClient((call) => ({
			data: storedNotice(call.payload as Record<string, unknown>),
			error: null
		}));
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);
		await createNotification({
			userId,
			type: 'organizer_application_approved',
			title: 'Organizer access approved',
			body: 'You can publish a tournament now.',
			link: '/tournaments/manage'
		});
		expect(calls[0]).toMatchObject({ table: 'notifications', op: 'insert' });
		expect(calls[0].payload).not.toHaveProperty('read_at');
	});

	it('refuses a client insert and an off-site link', () => {
		const draft = {
			userId,
			type: 'organizer_application_approved',
			title: 'Organizer access approved',
			body: 'You can publish a tournament now.',
			link: '/tournaments/manage'
		};
		expect(() => notificationInsertRow(draft, 'authenticated' satisfies NotificationActor)).toThrow(
			/server/
		);
		expect(() => notificationInsertRow({ ...draft, link: 'https://evil.test/phish' })).toThrow(/site path/);
		expect(() => notificationInsertRow({ ...draft, link: '//evil.test' })).toThrow(/site path/);
	});

	it('lets a player read only their own notices', () => {
		expect(canReadNotification(userId, { userId })).toBe(true);
		expect(canReadNotification(otherId, { userId })).toBe(false);
		const visible = notificationsForViewer(userId, [
			{ userId, id: 'own' },
			{ userId: otherId, id: 'other' }
		]);
		expect(visible.map((row) => row.id)).toEqual(['own']);
	});

	it('read-state updates set read_at only, and only for the owner', () => {
		expect(notificationReadPatch(userId, userId, '2026-11-24T12:00:00.000Z')).toEqual({
			read_at: '2026-11-24T12:00:00.000Z'
		});
		expect(() => notificationReadPatch(userId, otherId, '2026-11-24T12:00:00.000Z')).toThrow(/own notifications/);
	});

	it('lists with the viewer filter and drops a row the viewer does not own', async () => {
		const own = storedNotice({
			user_id: userId,
			type: 'organizer_application_approved',
			title: 'Organizer access approved',
			body: 'You can publish a tournament now.',
			link: '/tournaments/manage'
		});
		const foreign = { ...own, id: otherId, user_id: otherId, title: 'Not yours' };
		const { client, calls } = createClient(() => ({ data: [own, foreign], error: null }));
		const inbox = await listMyNotifications(client as never, userId, 10);
		expect(inbox.available).toBe(true);
		expect(inbox.notifications.map((item) => item.title)).toEqual(['Organizer access approved']);
		expect(calls[0].filters).toContainEqual(['eq', 'user_id', userId]);
	});

	it('marks one notice read without writing any other column', async () => {
		const { client, calls } = createClient(() => ({
			data: {
				...storedNotice({
					user_id: userId,
					type: 'organizer_application_approved',
					title: 'Organizer access approved',
					body: 'You can publish a tournament now.',
					link: '/tournaments/manage'
				}),
				read_at: '2026-11-24T12:00:00.000Z'
			},
			error: null
		}));
		await markNotificationRead(client as never, userId, noteId, '2026-11-24T12:00:00.000Z');
		expect(calls[0].payload).toEqual({ read_at: '2026-11-24T12:00:00.000Z' });
		expect(calls[0].filters).toEqual([
			['eq', 'id', noteId],
			['eq', 'user_id', userId]
		]);
	});

	it('does not treat another player’s row as marked read', async () => {
		const { client } = createClient(() => ({
			data: {
				...storedNotice({
					user_id: otherId,
					type: 'organizer_access_revoked',
					title: 'Organizer access removed',
					body: 'Gone.',
					link: null
				}),
				read_at: '2026-11-24T12:00:00.000Z'
			},
			error: null
		}));
		await expect(markNotificationRead(client as never, userId, noteId, '2026-11-24T12:00:00.000Z')).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('marks every unread notice for that player only', async () => {
		const { client, calls } = createClient(() => ({ data: null, error: null }));
		await markAllNotificationsRead(client as never, userId, '2026-11-24T12:00:00.000Z');
		expect(calls[0].payload).toEqual({ read_at: '2026-11-24T12:00:00.000Z' });
		expect(calls[0].filters).toEqual([
			['eq', 'user_id', userId],
			['is', 'read_at', null]
		]);
	});

	it('keeps a rejection note inside the notice body', () => {
		const note = 'n'.repeat(2000);
		const notice = organizerApplicantNotice('rejected', note);
		expect(notice.body.length).toBeLessThanOrEqual(2000);
		expect(notice.body).toContain('not approved');
		expect(notice.body).toContain('nnn');
		expect(organizerApplicantNotice('rejected', null).body).toContain('Settings');
		expect(isDeliverableEmail('steam_1@users.tyrhq.invalid')).toBe(false);
		expect(isDeliverableEmail('pilot@example.com')).toBe(true);
	});
});

describe('organizer approve, reject, and revoke notices', () => {
	beforeEach(() => {
		vi.mocked(getSupabaseAdminClient).mockReset();
		vi.mocked(sendEmail).mockClear();
	});

	function adminFor(email: string | null, notificationError: { message: string; code?: string } | null = null) {
		return createClient((call) => {
			if (call.table === 'notifications') {
				if (notificationError) return { data: null, error: notificationError };
				return { data: storedNotice(call.payload as Record<string, unknown>), error: null };
			}
			if (call.table === 'profiles' && call.op === 'update') {
				const payload = call.payload as { is_tournament_organizer?: boolean };
				return {
					data: {
						id: userId,
						display_name: 'Pilot',
						role: 'user',
						is_tournament_organizer: Boolean(payload.is_tournament_organizer)
					},
					error: null
				};
			}
			if (call.op === 'update') {
				return {
					data: {
						id: 'app-1',
						user_id: userId,
						discord_handle: 'pilot',
						past_events: 'https://example.com/cup',
						event_format: '8v8',
						region: 'NA',
						frequency: 'Monthly',
						expected_player_count: 64,
						status: 'approved',
						review_note: 'Welcome.',
						reviewed_at: '2026-11-24T12:00:00.000Z',
						created_at: '2026-11-20T00:00:00.000Z',
						applicant: { display_name: 'Pilot' }
					},
					error: null
				};
			}
			return { data: { id: 'app-1', user_id: userId, status: 'pending' }, error: null };
		}, email);
	}

	it('approval writes a notice and calls the email hook', async () => {
		const { client, calls } = adminFor('pilot@example.com');
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);

		const reviewed = await reviewOrganizerApplication(
			'app-1',
			{ id: '22222222-2222-4222-8222-222222222222', role: 'admin' },
			{ decision: 'approve', note: 'Welcome aboard.' }
		);

		expect(reviewed.status).toBe('approved');
		const insert = calls.find((call) => call.table === 'notifications' && call.op === 'insert');
		expect(insert?.payload).toMatchObject({
			user_id: userId,
			type: 'organizer_application_approved',
			title: 'Organizer access approved',
			link: '/tournaments/manage'
		});
		expect((insert?.payload as { body: string }).body).toContain('Welcome aboard.');
		expect(sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'pilot@example.com',
				subject: 'Organizer application approved',
				text: expect.stringContaining('Welcome aboard.')
			})
		);
	});

	it('rejection includes the admin note and does not grant organizer access', async () => {
		const { client, calls } = adminFor('pilot@example.com');
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);

		await reviewOrganizerApplication(
			'app-1',
			{ id: '22222222-2222-4222-8222-222222222222', role: 'admin' },
			{ decision: 'reject', note: 'Not this season.' }
		);

		const insert = calls.find((call) => call.table === 'notifications' && call.op === 'insert');
		expect(insert?.payload).toMatchObject({
			type: 'organizer_application_rejected',
			link: '/settings#organizer-application'
		});
		expect((insert?.payload as { body: string }).body).toContain('Not this season.');
		expect(calls.some((call) => call.table === 'profiles')).toBe(false);
		expect(sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'pilot@example.com',
				subject: 'Organizer application update',
				text: expect.stringContaining('Not this season.')
			})
		);
	});

	it('revoke notifies in the app and does not email', async () => {
		const { client, calls } = adminFor('pilot@example.com');
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);

		const updated = await revokeOrganizerAccess(userId, { role: 'admin' });
		expect(updated.isTournamentOrganizer).toBe(false);
		expect(calls.find((call) => call.table === 'notifications')?.payload).toMatchObject({
			user_id: userId,
			type: 'organizer_access_revoked',
			link: '/settings#organizer-application'
		});
		expect(calls.some((call) => call.table === 'tournaments')).toBe(false);
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it('skips placeholder Steam addresses', async () => {
		const { client, calls } = adminFor('steam_765@users.tyrhq.invalid');
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);

		await reviewOrganizerApplication(
			'app-1',
			{ id: '22222222-2222-4222-8222-222222222222', role: 'admin' },
			{ decision: 'approve' }
		);
		expect(calls.some((call) => call.table === 'notifications' && call.op === 'insert')).toBe(true);
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it('keeps the decision when the notifications table is not there yet', async () => {
		const { client, calls } = adminFor('pilot@example.com', {
			code: 'PGRST205',
			message: 'Could not find the table public.notifications in the schema cache'
		});
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const reviewed = await reviewOrganizerApplication(
			'app-1',
			{ id: '22222222-2222-4222-8222-222222222222', role: 'admin' },
			{ decision: 'approve', note: 'Welcome.' }
		);
		expect(reviewed.status).toBe('approved');
		expect(calls.filter((call) => call.table === 'organizer_applications' && call.op === 'update')).toHaveLength(1);
		expect(sendEmail).toHaveBeenCalled();
		vi.mocked(console.error).mockRestore();
	});
});
