import { getSupabaseAdminClient } from './supabase-admin';
import type { ProfileRole } from './users';

export type CommunityEventStatus = 'pending' | 'approved' | 'rejected';

export interface CommunityEventRecord {
	id: string;
	title: string;
	description: string;
	location: string | null;
	url: string | null;
	starts_at: string;
	ends_at: string | null;
	status: CommunityEventStatus;
	submitter_id: string;
	decided_by: string | null;
	decided_at: string | null;
	review_notes: string | null;
	created_at: string;
	updated_at: string;
	/** Display name of the submitting profile, joined for list views. */
	submitter_display: string | null;
}

const EVENT_COLUMNS =
	'id, title, description, location, url, starts_at, ends_at, status, submitter_id, decided_by, decided_at, review_notes, created_at, updated_at, submitter:profiles!community_events_submitter_id_fkey(display_name)';

export class CommunityEventError extends Error {
	readonly statusCode: number;
	constructor(message: string, statusCode = 400) {
		super(message);
		this.name = 'CommunityEventError';
		this.statusCode = statusCode;
	}
}

function requireAdmin() {
	const admin = getSupabaseAdminClient();
	if (!admin) {
		throw new CommunityEventError(
			'Community events require SUPABASE_SERVICE_ROLE_KEY to be configured.',
			503
		);
	}
	return admin;
}

interface EventJoinRow extends Omit<CommunityEventRecord, 'submitter_display'> {
	submitter: { display_name: string | null } | null;
}

function toRecord(row: EventJoinRow): CommunityEventRecord {
	const { submitter, ...rest } = row;
	return { ...rest, submitter_display: submitter?.display_name ?? null };
}

export const EVENT_LIMITS = {
	titleMin: 3,
	titleMax: 140,
	descriptionMax: 2000,
	locationMax: 120,
	urlMax: 1024,
	/** How far in the past an event may start and still be submitted (grace for "starting now"). */
	startGraceMinutes: 60,
	/** How far out an event may be scheduled. */
	maxLeadDays: 365,
	/** Longest allowed event duration. */
	maxDurationDays: 30
} as const;

export interface CommunityEventInput {
	title: string;
	description?: string | null;
	location?: string | null;
	url?: string | null;
	/** ISO-8601 timestamps. */
	startsAt: string;
	endsAt?: string | null;
}

export interface ValidatedEventInput {
	title: string;
	description: string;
	location: string | null;
	url: string | null;
	startsAt: string;
	endsAt: string | null;
}

export interface ValidateEventOptions {
	/**
	 * Skip the start-must-be-in-the-future check. Used when editing an event
	 * whose start time is unchanged, so a live or recently started event can
	 * still have its details corrected.
	 */
	allowPastStart?: boolean;
}

/**
 * Normalise and validate raw event input. Pure — throws CommunityEventError
 * (422) on the first problem so callers can surface it verbatim in the form.
 */
export function validateEventInput(
	input: CommunityEventInput,
	now: Date = new Date(),
	options: ValidateEventOptions = {}
): ValidatedEventInput {
	const title = input.title.trim();
	if (title.length < EVENT_LIMITS.titleMin) {
		throw new CommunityEventError(
			`Title must be at least ${EVENT_LIMITS.titleMin} characters.`,
			422
		);
	}
	if (title.length > EVENT_LIMITS.titleMax) {
		throw new CommunityEventError(
			`Title must be ${EVENT_LIMITS.titleMax} characters or fewer.`,
			422
		);
	}

	const description = (input.description ?? '').trim();
	if (description.length > EVENT_LIMITS.descriptionMax) {
		throw new CommunityEventError(
			`Description must be ${EVENT_LIMITS.descriptionMax} characters or fewer.`,
			422
		);
	}

	const location = input.location?.trim() || null;
	if (location && location.length > EVENT_LIMITS.locationMax) {
		throw new CommunityEventError(
			`Location must be ${EVENT_LIMITS.locationMax} characters or fewer.`,
			422
		);
	}

	const rawUrl = input.url?.trim() || null;
	let url: string | null = null;
	if (rawUrl) {
		if (rawUrl.length > EVENT_LIMITS.urlMax) {
			throw new CommunityEventError('Link URL is too long.', 422);
		}
		let parsed: URL;
		try {
			parsed = new URL(rawUrl);
		} catch {
			throw new CommunityEventError('Link must be a valid URL.', 422);
		}
		if (parsed.protocol !== 'https:') {
			throw new CommunityEventError('Link must use https.', 422);
		}
		url = parsed.toString();
	}

	const startsAtMs = Date.parse(input.startsAt);
	if (Number.isNaN(startsAtMs)) {
		throw new CommunityEventError('Start time must be a valid date.', 422);
	}
	const graceMs = EVENT_LIMITS.startGraceMinutes * 60_000;
	if (!options.allowPastStart && startsAtMs < now.getTime() - graceMs) {
		throw new CommunityEventError('Start time must be in the future.', 422);
	}
	if (startsAtMs > now.getTime() + EVENT_LIMITS.maxLeadDays * 86_400_000) {
		throw new CommunityEventError(
			`Events can be scheduled at most ${EVENT_LIMITS.maxLeadDays} days ahead.`,
			422
		);
	}

	let endsAt: string | null = null;
	if (input.endsAt) {
		const endsAtMs = Date.parse(input.endsAt);
		if (Number.isNaN(endsAtMs)) {
			throw new CommunityEventError('End time must be a valid date.', 422);
		}
		if (endsAtMs < startsAtMs) {
			throw new CommunityEventError('End time must be after the start time.', 422);
		}
		if (endsAtMs - startsAtMs > EVENT_LIMITS.maxDurationDays * 86_400_000) {
			throw new CommunityEventError(
				`Events can run for at most ${EVENT_LIMITS.maxDurationDays} days.`,
				422
			);
		}
		endsAt = new Date(endsAtMs).toISOString();
	}

	return {
		title,
		description,
		location,
		url,
		startsAt: new Date(startsAtMs).toISOString(),
		endsAt
	};
}

const RATE_LIMITS = {
	maxPending: 3,
	maxCreatedPerDay: 5
} as const;

async function assertPendingCap(submitterId: string): Promise<void> {
	const admin = requireAdmin();
	const { count: pendingCount, error: pendingError } = await admin
		.from('community_events')
		.select('id', { head: true, count: 'exact' })
		.eq('submitter_id', submitterId)
		.eq('status', 'pending');
	if (pendingError) {
		console.error('[events] pending count failed', pendingError);
		throw new CommunityEventError('Could not verify submission limits.', 500);
	}
	if ((pendingCount ?? 0) >= RATE_LIMITS.maxPending) {
		throw new CommunityEventError(
			`You already have ${RATE_LIMITS.maxPending} events awaiting review. Wait for a decision before submitting more.`,
			429
		);
	}
}

async function assertEventRateLimits(submitterId: string): Promise<void> {
	const admin = requireAdmin();

	await assertPendingCap(submitterId);

	const since = new Date(Date.now() - 86_400_000).toISOString();
	const { count: dayCount, error: dayError } = await admin
		.from('community_events')
		.select('id', { head: true, count: 'exact' })
		.eq('submitter_id', submitterId)
		.gte('created_at', since);
	if (dayError) {
		console.error('[events] daily count failed', dayError);
		throw new CommunityEventError('Could not verify submission limits.', 500);
	}
	if ((dayCount ?? 0) >= RATE_LIMITS.maxCreatedPerDay) {
		throw new CommunityEventError(
			'Daily event submission limit reached. Try again tomorrow.',
			429
		);
	}
}

/**
 * Create an event. Reviewer ("contributor") and admin events publish
 * immediately; regular users' events enter the pending moderation queue and
 * are rate-limited.
 */
export async function createEvent(
	input: CommunityEventInput,
	actor: { id: string; role: ProfileRole }
): Promise<CommunityEventRecord> {
	const admin = requireAdmin();
	const validated = validateEventInput(input);

	const elevated = actor.role === 'contributor' || actor.role === 'admin';
	if (!elevated) await assertEventRateLimits(actor.id);

	const nowIso = new Date().toISOString();
	const { data, error } = await admin
		.from('community_events')
		.insert({
			title: validated.title,
			description: validated.description,
			location: validated.location,
			url: validated.url,
			starts_at: validated.startsAt,
			ends_at: validated.endsAt,
			status: elevated ? 'approved' : 'pending',
			submitter_id: actor.id,
			decided_by: elevated ? actor.id : null,
			decided_at: elevated ? nowIso : null
		})
		.select(EVENT_COLUMNS)
		.single<EventJoinRow>();

	if (error || !data) {
		console.error('[events] createEvent failed', error);
		throw new CommunityEventError('Could not create the event.', 500);
	}
	return toRecord(data);
}

/**
 * Fetch a single event for editing. Submitters can load their own events;
 * reviewers/admins can load any event.
 */
export async function getEventForActor(
	eventId: string,
	actor: { id: string; role: ProfileRole }
): Promise<CommunityEventRecord> {
	const admin = requireAdmin();
	const { data, error } = await admin
		.from('community_events')
		.select(EVENT_COLUMNS)
		.eq('id', eventId)
		.maybeSingle<EventJoinRow>();
	if (error) {
		console.error('[events] getEventForActor failed', error);
		throw new CommunityEventError('Could not look up the event.', 500);
	}
	if (!data) throw new CommunityEventError('Event not found.', 404);

	const elevated = actor.role === 'contributor' || actor.role === 'admin';
	if (!elevated && data.submitter_id !== actor.id) {
		throw new CommunityEventError('You can only edit your own events.', 403);
	}
	return toRecord(data);
}

/**
 * Edit an event. Submitters can edit their own events; reviewers/admins can
 * edit any event. An edit by a regular user always puts the event (back) in
 * the pending queue — approved events leave the public calendar until
 * re-approved, and rejected events are resubmitted — so approval always
 * covers the content that is actually shown. Elevated edits keep the
 * current status.
 */
export async function updateEvent(
	eventId: string,
	input: CommunityEventInput,
	actor: { id: string; role: ProfileRole }
): Promise<CommunityEventRecord> {
	const admin = requireAdmin();

	const { data: existing, error: lookupError } = await admin
		.from('community_events')
		.select('id, status, submitter_id, starts_at')
		.eq('id', eventId)
		.maybeSingle<{
			id: string;
			status: CommunityEventStatus;
			submitter_id: string;
			starts_at: string;
		}>();
	if (lookupError) {
		console.error('[events] updateEvent lookup failed', lookupError);
		throw new CommunityEventError('Could not look up the event.', 500);
	}
	if (!existing) throw new CommunityEventError('Event not found.', 404);

	const elevated = actor.role === 'contributor' || actor.role === 'admin';
	if (!elevated && existing.submitter_id !== actor.id) {
		throw new CommunityEventError('You can only edit your own events.', 403);
	}

	// A live/past event can keep its start time while its details are fixed;
	// any *changed* start time must pass the normal future-window checks.
	const startUnchanged = Date.parse(input.startsAt) === Date.parse(existing.starts_at);
	const validated = validateEventInput(input, new Date(), { allowPastStart: startUnchanged });

	const resubmitting = !elevated && existing.status !== 'pending';
	if (resubmitting) await assertPendingCap(actor.id);

	const patch: Record<string, unknown> = {
		title: validated.title,
		description: validated.description,
		location: validated.location,
		url: validated.url,
		starts_at: validated.startsAt,
		ends_at: validated.endsAt
	};
	if (!elevated) {
		patch.status = 'pending';
		patch.decided_by = null;
		patch.decided_at = null;
		patch.review_notes = null;
	}

	const { data, error } = await admin
		.from('community_events')
		.update(patch)
		.eq('id', eventId)
		.select(EVENT_COLUMNS)
		.single<EventJoinRow>();

	if (error || !data) {
		console.error('[events] updateEvent failed', error);
		throw new CommunityEventError('Could not update the event.', 500);
	}
	return toRecord(data);
}

/**
 * Approve or reject a pending event. Reviewer/admin only. Unlike article
 * submissions there is no self-approval restriction — elevated roles publish
 * their own events directly anyway.
 */
export async function decideEvent(
	eventId: string,
	actor: { id: string; role: ProfileRole },
	decision: { decision: 'approve' | 'reject'; notes?: string | null }
): Promise<CommunityEventRecord> {
	if (actor.role !== 'contributor' && actor.role !== 'admin') {
		throw new CommunityEventError('Reviewer role required.', 403);
	}
	const admin = requireAdmin();

	const notes = decision.notes?.trim() || null;
	if (notes && notes.length > EVENT_LIMITS.descriptionMax) {
		throw new CommunityEventError('Review notes are too long.', 422);
	}

	// Guard the transition with a status filter so two concurrent decisions
	// can't both win — the second UPDATE matches zero rows.
	const { data, error } = await admin
		.from('community_events')
		.update({
			status: decision.decision === 'approve' ? 'approved' : 'rejected',
			decided_by: actor.id,
			decided_at: new Date().toISOString(),
			review_notes: notes
		})
		.eq('id', eventId)
		.eq('status', 'pending')
		.select(EVENT_COLUMNS)
		.maybeSingle<EventJoinRow>();

	if (error) {
		console.error('[events] decideEvent failed', error);
		throw new CommunityEventError('Could not record the decision.', 500);
	}
	if (!data) {
		const { data: existing } = await admin
			.from('community_events')
			.select('id, status')
			.eq('id', eventId)
			.maybeSingle<{ id: string; status: CommunityEventStatus }>();
		if (!existing) throw new CommunityEventError('Event not found.', 404);
		throw new CommunityEventError(
			`Event was already ${existing.status}.`,
			409
		);
	}
	return toRecord(data);
}

/**
 * Delete an event. Submitters can withdraw their own *pending* events;
 * reviewers/admins can remove any event (e.g. cancellations or spam).
 */
export async function removeEvent(
	eventId: string,
	actor: { id: string; role: ProfileRole }
): Promise<void> {
	const admin = requireAdmin();

	const { data: existing, error: lookupError } = await admin
		.from('community_events')
		.select('id, status, submitter_id')
		.eq('id', eventId)
		.maybeSingle<{ id: string; status: CommunityEventStatus; submitter_id: string }>();
	if (lookupError) {
		console.error('[events] removeEvent lookup failed', lookupError);
		throw new CommunityEventError('Could not look up the event.', 500);
	}
	if (!existing) throw new CommunityEventError('Event not found.', 404);

	const elevated = actor.role === 'contributor' || actor.role === 'admin';
	const ownPending = existing.submitter_id === actor.id && existing.status === 'pending';
	if (!elevated && !ownPending) {
		throw new CommunityEventError(
			'You can only withdraw your own events while they are awaiting review.',
			403
		);
	}

	const { error } = await admin.from('community_events').delete().eq('id', eventId);
	if (error) {
		console.error('[events] removeEvent delete failed', error);
		throw new CommunityEventError('Could not delete the event.', 500);
	}
}

/**
 * Approved events that are upcoming or still running, soonest first.
 * Returns [] when Supabase isn't configured so the public page still renders.
 */
export async function listUpcomingEvents(limit = 50): Promise<CommunityEventRecord[]> {
	const admin = getSupabaseAdminClient();
	if (!admin) return [];
	const nowIso = new Date().toISOString();
	const { data, error } = await admin
		.from('community_events')
		.select(EVENT_COLUMNS)
		.eq('status', 'approved')
		.or(`starts_at.gte.${nowIso},ends_at.gte.${nowIso}`)
		.order('starts_at', { ascending: true })
		.limit(limit);
	if (error) {
		console.error('[events] listUpcomingEvents failed', error);
		return [];
	}
	return ((data as unknown as EventJoinRow[]) ?? []).map(toRecord);
}

/** Recently finished approved events, most recent first. */
export async function listPastEvents(limit = 10): Promise<CommunityEventRecord[]> {
	const admin = getSupabaseAdminClient();
	if (!admin) return [];
	const nowIso = new Date().toISOString();
	const { data, error } = await admin
		.from('community_events')
		.select(EVENT_COLUMNS)
		.eq('status', 'approved')
		.lt('starts_at', nowIso)
		.or(`ends_at.is.null,ends_at.lt.${nowIso}`)
		.order('starts_at', { ascending: false })
		.limit(limit);
	if (error) {
		console.error('[events] listPastEvents failed', error);
		return [];
	}
	return ((data as unknown as EventJoinRow[]) ?? []).map(toRecord);
}

/** A user's own submissions (any status), newest first. */
export async function listEventsForUser(
	userId: string,
	limit = 50
): Promise<CommunityEventRecord[]> {
	const admin = getSupabaseAdminClient();
	if (!admin) return [];
	const { data, error } = await admin
		.from('community_events')
		.select(EVENT_COLUMNS)
		.eq('submitter_id', userId)
		.order('created_at', { ascending: false })
		.limit(limit);
	if (error) {
		console.error('[events] listEventsForUser failed', error);
		return [];
	}
	return ((data as unknown as EventJoinRow[]) ?? []).map(toRecord);
}

/** Moderation queue: pending events, earliest start first. */
export async function listPendingEvents(): Promise<CommunityEventRecord[]> {
	const admin = requireAdmin();
	const { data, error } = await admin
		.from('community_events')
		.select(EVENT_COLUMNS)
		.eq('status', 'pending')
		.order('starts_at', { ascending: true });
	if (error) {
		console.error('[events] listPendingEvents failed', error);
		return [];
	}
	return ((data as unknown as EventJoinRow[]) ?? []).map(toRecord);
}

/** Pending-queue size for the header badge. 0 when Supabase isn't configured. */
export async function countPendingEvents(): Promise<number> {
	const admin = getSupabaseAdminClient();
	if (!admin) return 0;
	const { count, error } = await admin
		.from('community_events')
		.select('id', { head: true, count: 'exact' })
		.eq('status', 'pending');
	if (error) {
		console.error('[events] countPendingEvents failed', error);
		return 0;
	}
	return count ?? 0;
}
