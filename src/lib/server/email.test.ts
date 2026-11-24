import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reviewOrganizerApplication, revokeOrganizerAccess } from './organizer-applications';
import { isTransactionalEmailConfigured, sendEmail } from './email';
import { getSupabaseAdminClient } from './supabase-admin';

const { privateEnv } = vi.hoisted(() => ({
	privateEnv: {
		RESEND_API_KEY: '',
		EMAIL_FROM: ''
	} as Record<string, string>
}));

vi.mock('$env/dynamic/private', () => ({
	env: privateEnv
}));

vi.mock('./supabase-admin', () => ({
	getSupabaseAdminClient: vi.fn()
}));

const fetchMock = vi.fn();
const userId = '11111111-1111-4111-8111-111111111111';
const applicantEmail = 'pilot@example.com';
const apiKey = 'test-resend-key';
const fromAddress = 'Tyr HQ <notify@example.com>';

type Call = {
	table: string;
	op: 'select' | 'insert' | 'update';
	payload?: unknown;
};

function applicationRow(status: 'approved' | 'rejected', note: string | null) {
	return {
		id: 'app-1',
		user_id: userId,
		discord_handle: 'pilot',
		past_events: 'https://example.com/cup',
		event_format: '8v8',
		region: 'NA',
		frequency: 'Monthly',
		expected_player_count: 64,
		status,
		review_note: note,
		reviewed_at: '2026-11-24T12:00:00.000Z',
		created_at: '2026-11-20T00:00:00.000Z',
		applicant: { display_name: 'Pilot' }
	};
}

function createAdmin(email: string | null = applicantEmail) {
	const calls: Call[] = [];
	const client = {
		from(table: string) {
			let op: Call['op'] = 'select';
			let payload: unknown;
			const run = () => {
				const call: Call = { table, op, payload };
				calls.push(call);
				if (table === 'notifications' && op === 'insert') {
					const row = payload as Record<string, unknown>;
					return {
						data: {
							id: '44444444-4444-4444-8444-444444444444',
							user_id: row.user_id,
							type: row.type,
							title: row.title,
							body: row.body,
							link: row.link ?? null,
							read_at: null,
							created_at: '2026-11-24T12:00:00.000Z'
						},
						error: null
					};
				}
				if (table === 'profiles' && op === 'update') {
					const row = payload as { is_tournament_organizer?: boolean };
					return {
						data: {
							id: userId,
							display_name: 'Pilot',
							role: 'user',
							is_tournament_organizer: Boolean(row.is_tournament_organizer)
						},
						error: null
					};
				}
				if (table === 'organizer_applications' && op === 'update') {
					const row = payload as { status: 'approved' | 'rejected'; review_note: string | null };
					return { data: applicationRow(row.status, row.review_note), error: null };
				}
				return { data: { id: 'app-1', user_id: userId, status: 'pending' }, error: null };
			};
			const builder = {
				select: () => builder,
				eq: () => builder,
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
				single: () => Promise.resolve(run())
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

function loggedText(): string {
	return vi
		.mocked(console.error)
		.mock.calls.flat()
		.map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
		.join('\n');
}

function sentBody(): { from: string; to: string; subject: string; text: string } {
	const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
	return JSON.parse(String(init?.body));
}

describe('sendEmail', () => {
	beforeEach(() => {
		privateEnv.RESEND_API_KEY = '';
		privateEnv.EMAIL_FROM = '';
		fetchMock.mockReset();
		vi.stubGlobal('fetch', fetchMock);
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('stays unconfigured until both the key and the from address are set', async () => {
		expect(isTransactionalEmailConfigured()).toBe(false);
		await expect(
			sendEmail({
				to: applicantEmail,
				subject: 'Organizer application approved',
				text: 'You can publish a tournament now.'
			})
		).resolves.toEqual({ delivered: false, reason: 'not_configured' });

		privateEnv.RESEND_API_KEY = apiKey;
		privateEnv.EMAIL_FROM = '   ';
		expect(isTransactionalEmailConfigured()).toBe(false);

		privateEnv.RESEND_API_KEY = '  ';
		privateEnv.EMAIL_FROM = fromAddress;
		expect(isTransactionalEmailConfigured()).toBe(false);

		await sendEmail({
			to: applicantEmail,
			subject: 'Organizer application approved',
			text: 'You can publish a tournament now.'
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('posts a short message when mail is configured', async () => {
		privateEnv.RESEND_API_KEY = apiKey;
		privateEnv.EMAIL_FROM = fromAddress;
		fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '{"id":"email_123"}' });

		await expect(
			sendEmail({
				to: `  ${applicantEmail}  `,
				subject: ' Organizer application approved ',
				text: ' You can publish a tournament now. '
			})
		).resolves.toEqual({ delivered: true });

		expect(isTransactionalEmailConfigured()).toBe(true);
		expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				from: fromAddress,
				to: applicantEmail,
				subject: 'Organizer application approved',
				text: 'You can publish a tournament now.'
			})
		});
		expect(loggedText()).not.toContain(apiKey);
	});

	it('returns a failure when Resend rejects the message and does not log the key', async () => {
		privateEnv.RESEND_API_KEY = apiKey;
		privateEnv.EMAIL_FROM = fromAddress;
		fetchMock.mockResolvedValue({
			ok: false,
			status: 422,
			text: async () => `rejected ${apiKey}`
		});

		await expect(
			sendEmail({
				to: applicantEmail,
				subject: 'Organizer application update',
				text: 'Not this season.'
			})
		).resolves.toEqual({ delivered: false, reason: 'provider_error' });

		expect(loggedText()).not.toContain(apiKey);
		expect(loggedText()).toContain('422');
	});

	it('returns a failure when the request throws', async () => {
		privateEnv.RESEND_API_KEY = apiKey;
		privateEnv.EMAIL_FROM = fromAddress;
		fetchMock.mockRejectedValue(new Error(`network down ${apiKey}`));

		await expect(
			sendEmail({
				to: applicantEmail,
				subject: 'Organizer application approved',
				text: 'You can publish a tournament now.'
			})
		).resolves.toEqual({ delivered: false, reason: 'request_failed' });

		expect(loggedText()).not.toContain(apiKey);
	});

	it('refuses an empty message', async () => {
		await expect(sendEmail({ to: '', subject: 'Hi', text: 'Hello' })).rejects.toThrow(/recipient/);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('organizer decisions when mail fails', () => {
	beforeEach(() => {
		privateEnv.RESEND_API_KEY = apiKey;
		privateEnv.EMAIL_FROM = fromAddress;
		fetchMock.mockReset();
		vi.stubGlobal('fetch', fetchMock);
		vi.mocked(getSupabaseAdminClient).mockReset();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('approval still grants access and writes the in-app notice when the email sends', async () => {
		const { client, calls } = createAdmin();
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);
		fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '{"id":"email_ok"}' });

		const reviewed = await reviewOrganizerApplication(
			'app-1',
			{ id: '22222222-2222-4222-8222-222222222222', role: 'admin' },
			{ decision: 'approve', note: 'Welcome aboard.' }
		);

		expect(reviewed.status).toBe('approved');
		expect(calls.some((call) => call.table === 'notifications' && call.op === 'insert')).toBe(true);
		expect(sentBody()).toMatchObject({
			to: applicantEmail,
			subject: 'Organizer application approved',
			text: expect.stringContaining('Welcome aboard.')
		});
	});

	it('rejection still records the decision when Resend fails, and the note is in the email', async () => {
		const { client, calls } = createAdmin();
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);
		fetchMock.mockResolvedValue({
			ok: false,
			status: 500,
			text: async () => `unavailable ${apiKey}`
		});

		const reviewed = await reviewOrganizerApplication(
			'app-1',
			{ id: '22222222-2222-4222-8222-222222222222', role: 'admin' },
			{ decision: 'reject', note: 'Not this season.' }
		);

		expect(reviewed.status).toBe('rejected');
		const insert = calls.find((call) => call.table === 'notifications' && call.op === 'insert');
		expect(insert?.payload).toMatchObject({
			user_id: userId,
			type: 'organizer_application_rejected'
		});
		expect((insert?.payload as { body: string }).body).toContain('Not this season.');
		expect(calls.some((call) => call.table === 'profiles')).toBe(false);
		expect(sentBody()).toMatchObject({
			to: applicantEmail,
			subject: 'Organizer application update',
			text: expect.stringContaining('Not this season.')
		});
		expect(loggedText()).not.toContain(apiKey);
	});

	it('keeps an approval when the email request throws', async () => {
		const { client, calls } = createAdmin();
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);
		fetchMock.mockRejectedValue(new Error('network down'));

		const reviewed = await reviewOrganizerApplication(
			'app-1',
			{ id: '22222222-2222-4222-8222-222222222222', role: 'admin' },
			{ decision: 'approve', note: 'Welcome aboard.' }
		);

		expect(reviewed.status).toBe('approved');
		expect(calls.find((call) => call.table === 'notifications' && call.op === 'insert')?.payload).toMatchObject({
			type: 'organizer_application_approved'
		});
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it('revoke stays in the app and does not email', async () => {
		const { client, calls } = createAdmin();
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);
		fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '{"id":"should-not-send"}' });

		const updated = await revokeOrganizerAccess(userId, { role: 'admin' });

		expect(updated.isTournamentOrganizer).toBe(false);
		expect(calls.find((call) => call.table === 'notifications')?.payload).toMatchObject({
			type: 'organizer_access_revoked'
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
