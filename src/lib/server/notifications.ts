import type { SupabaseClient } from '@supabase/supabase-js';

import { isSafeAppPath, type NotificationItem } from '$lib/notifications';
import { sendEmail, type OutboundEmail } from './email';
import { getSupabaseAdminClient } from './supabase-admin';

const BODY_MAX = 2000;
const TITLE_MAX = 140;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

const NOTIFICATION_COLUMNS = 'id, user_id, type, title, body, link, read_at, created_at';

export type NotificationActor = 'server' | 'authenticated';

export type OrganizerNoticeKind = 'approved' | 'rejected' | 'revoked';

export interface NotificationDraft {
	userId: string;
	type: string;
	title: string;
	body: string;
	link?: string | null;
}

interface NotificationRow {
	id: string;
	user_id: string;
	type: string;
	title: string;
	body: string;
	link: string | null;
	read_at: string | null;
	created_at: string;
}

export class NotificationError extends Error {
	readonly statusCode: number;
	constructor(message: string, statusCode = 400) {
		super(message);
		this.name = 'NotificationError';
		this.statusCode = statusCode;
	}
}

export function isNotificationsSchemaMissing(
	error: { message?: string; code?: string } | null | undefined
): boolean {
	if (!error) return false;
	if (error.code === '42P01' || error.code === 'PGRST205') return true;
	return /schema cache|does not exist|could not find the table/i.test(error.message ?? '');
}

export function isDeliverableEmail(email: string | null | undefined): email is string {
	if (!email) return false;
	const trimmed = email.trim();
	if (trimmed.length > 320) return false;
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return false;
	return !trimmed.toLowerCase().endsWith('@users.tyrhq.invalid');
}

/** A signed-in player can read a row only when they own it. */
export function canReadNotification(viewerId: string, notification: { userId: string }): boolean {
	return Boolean(viewerId) && viewerId === notification.userId;
}

export function notificationsForViewer<T extends { userId: string }>(viewerId: string, rows: T[]): T[] {
	return rows.filter((row) => canReadNotification(viewerId, row));
}

/**
 * Client writes may set read_at and nothing else, and only on the owner's row.
 * The table grant and trigger enforce the same rule in Postgres.
 */
export function notificationReadPatch(
	ownerId: string,
	viewerId: string,
	readAt: string
): { read_at: string } {
	if (!viewerId || viewerId !== ownerId) {
		throw new NotificationError('You can only update your own notifications.', 403);
	}
	if (!readAt.trim()) throw new NotificationError('A read time is required.', 422);
	return { read_at: readAt };
}

export function notificationInsertRow(input: NotificationDraft, actor: NotificationActor = 'server') {
	if (actor !== 'server') {
		throw new NotificationError('Notifications are created by the server.', 403);
	}
	const userId = input.userId.trim();
	if (!UUID_PATTERN.test(userId)) {
		throw new NotificationError('Notification recipient is invalid.', 422);
	}
	const type = input.type.trim();
	if (!TYPE_PATTERN.test(type)) {
		throw new NotificationError('Notification type is invalid.', 422);
	}
	const title = input.title.trim();
	if (!title || title.length > TITLE_MAX) {
		throw new NotificationError('Notification title is invalid.', 422);
	}
	const body = input.body.trim();
	if (!body || body.length > BODY_MAX) {
		throw new NotificationError('Notification body is invalid.', 422);
	}
	const link = input.link?.trim() || null;
	if (link && !isSafeAppPath(link)) {
		throw new NotificationError('Notification link must be a site path.', 422);
	}
	return {
		user_id: userId,
		type,
		title,
		body,
		link
	};
}

function composeBody(lead: string, note: string | null): string {
	const trimmed = note?.trim() ?? '';
	if (!trimmed) return lead;
	const separator = '\n\n';
	const room = BODY_MAX - lead.length - separator.length;
	if (room < 1) return lead.slice(0, BODY_MAX);
	const clipped = trimmed.length > room ? `${trimmed.slice(0, Math.max(0, room - 3))}...` : trimmed;
	return `${lead}${separator}${clipped}`;
}

export function organizerApplicantNotice(kind: OrganizerNoticeKind, note: string | null) {
	if (kind === 'approved') {
		return {
			type: 'organizer_application_approved',
			title: 'Organizer access approved',
			body: composeBody('You can publish a tournament now.', note),
			link: '/tournaments/manage'
		};
	}
	if (kind === 'rejected') {
		return {
			type: 'organizer_application_rejected',
			title: 'Organizer application was not approved',
			body: composeBody(
				note?.trim()
					? 'Your organizer application was not approved.'
					: 'Your organizer application was not approved. You can see the status in Settings.',
				note
			),
			link: '/settings#organizer-application'
		};
	}
	return {
		type: 'organizer_access_revoked',
		title: 'Organizer access removed',
		body: 'Organizer access has been removed. Tournaments you already published stay on the site.',
		link: '/settings#organizer-application'
	};
}

export function organizerApplicantEmail(
	to: string,
	kind: 'approved' | 'rejected',
	note: string | null
): OutboundEmail {
	const notice = organizerApplicantNotice(kind, note);
	return {
		to,
		subject: kind === 'approved' ? 'Organizer application approved' : 'Organizer application update',
		text: notice.body
	};
}

function toItem(row: NotificationRow): NotificationItem {
	return {
		id: row.id,
		type: row.type,
		title: row.title,
		body: row.body,
		link: row.link ?? null,
		readAt: row.read_at ?? null,
		createdAt: row.created_at
	};
}

function requireAdminClient() {
	const admin = getSupabaseAdminClient();
	if (!admin) {
		throw new NotificationError('Notifications require SUPABASE_SERVICE_ROLE_KEY to be configured.', 503);
	}
	return admin;
}

export async function createNotification(input: NotificationDraft): Promise<NotificationItem> {
	const row = notificationInsertRow(input, 'server');
	const admin = requireAdminClient();
	const { data, error } = await admin
		.from('notifications')
		.insert(row)
		.select(NOTIFICATION_COLUMNS)
		.single<NotificationRow>();
	if (error || !data) {
		throw new NotificationError(
			isNotificationsSchemaMissing(error) ? 'Notifications are not available yet.' : 'Could not create the notification.',
			isNotificationsSchemaMissing(error) ? 503 : 500
		);
	}
	return toItem(data);
}

async function lookupDeliverableEmail(userId: string): Promise<string | null> {
	const admin = getSupabaseAdminClient();
	if (!admin) return null;
	const { data, error } = await admin.auth.admin.getUserById(userId);
	if (error) {
		console.error('[notifications] applicant email lookup failed', error);
		return null;
	}
	const email = data.user?.email ?? null;
	return isDeliverableEmail(email) ? email : null;
}

/**
 * Writes the in-app notice, then tries email for approve and reject.
 * A failure here does not undo the organizer decision.
 */
export async function deliverOrganizerApplicantNotice(
	userId: string,
	kind: OrganizerNoticeKind,
	note: string | null
): Promise<void> {
	const notice = organizerApplicantNotice(kind, note);
	try {
		await createNotification({ userId, ...notice });
	} catch (err) {
		console.error('[notifications] could not write organizer notice', err);
	}

	if (kind === 'revoked') return;

	try {
		const to = await lookupDeliverableEmail(userId);
		if (!to) return;
		await sendEmail(organizerApplicantEmail(to, kind, note));
	} catch (err) {
		console.error('[notifications] could not send organizer notice email', err);
	}
}

export async function listMyNotifications(
	supabase: SupabaseClient,
	userId: string,
	limit = 30
): Promise<{ available: boolean; notifications: NotificationItem[] }> {
	const capped = Math.min(Math.max(Math.trunc(limit), 1), 50);
	const { data, error } = await supabase
		.from('notifications')
		.select(NOTIFICATION_COLUMNS)
		.eq('user_id', userId)
		.order('created_at', { ascending: false })
		.limit(capped);

	if (error) {
		if (isNotificationsSchemaMissing(error)) return { available: false, notifications: [] };
		console.error('[notifications] list failed', error);
		return { available: true, notifications: [] };
	}

	const notifications = ((data as NotificationRow[] | null) ?? [])
		.filter((row) => canReadNotification(userId, { userId: row.user_id }))
		.map(toItem);
	return { available: true, notifications };
}

export async function countUnreadNotifications(supabase: SupabaseClient, userId: string): Promise<number> {
	const { count, error } = await supabase
		.from('notifications')
		.select('id', { count: 'exact', head: true })
		.eq('user_id', userId)
		.is('read_at', null);
	if (error) {
		if (!isNotificationsSchemaMissing(error)) console.error('[notifications] unread count failed', error);
		return 0;
	}
	return count ?? 0;
}

export async function loadHeaderNotifications(
	supabase: SupabaseClient | null,
	userId: string | null
): Promise<{ enabled: boolean; unreadCount: number; recent: NotificationItem[] }> {
	if (!supabase || !userId) return { enabled: false, unreadCount: 0, recent: [] };
	try {
		const inbox = await listMyNotifications(supabase, userId, 8);
		if (!inbox.available) return { enabled: false, unreadCount: 0, recent: [] };
		const unreadCount = await countUnreadNotifications(supabase, userId);
		return { enabled: true, unreadCount, recent: inbox.notifications };
	} catch (err) {
		console.error('[notifications] header load failed', err);
		return { enabled: false, unreadCount: 0, recent: [] };
	}
}

export async function markNotificationRead(
	supabase: SupabaseClient,
	userId: string,
	id: string,
	readAt = new Date().toISOString()
): Promise<NotificationItem> {
	if (!UUID_PATTERN.test(id)) throw new NotificationError('Notification not found.', 404);
	const patch = notificationReadPatch(userId, userId, readAt);
	const { data, error } = await supabase
		.from('notifications')
		.update(patch)
		.eq('id', id)
		.eq('user_id', userId)
		.select(NOTIFICATION_COLUMNS)
		.maybeSingle<NotificationRow>();
	if (error) {
		throw new NotificationError(
			isNotificationsSchemaMissing(error) ? 'Notifications are not available yet.' : 'Could not update the notification.',
			isNotificationsSchemaMissing(error) ? 503 : 500
		);
	}
	if (!data) throw new NotificationError('Notification not found.', 404);
	if (!canReadNotification(userId, { userId: data.user_id })) {
		throw new NotificationError('You can only update your own notifications.', 403);
	}
	return toItem(data);
}

export async function markAllNotificationsRead(
	supabase: SupabaseClient,
	userId: string,
	readAt = new Date().toISOString()
): Promise<void> {
	const patch = notificationReadPatch(userId, userId, readAt);
	const { error } = await supabase
		.from('notifications')
		.update(patch)
		.eq('user_id', userId)
		.is('read_at', null);
	if (error) {
		throw new NotificationError(
			isNotificationsSchemaMissing(error) ? 'Notifications are not available yet.' : 'Could not update notifications.',
			isNotificationsSchemaMissing(error) ? 503 : 500
		);
	}
}
