import { getSupabaseAdminClient } from './supabase-admin';
import { setTournamentOrganizer, type ProfileRole } from './users';

export type OrganizerApplicationStatus = 'pending' | 'approved' | 'rejected';

export const ORGANIZER_REAPPLY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export const ORGANIZER_APPLICATION_LIMITS = {
	discordMin: 2,
	discordMax: 100,
	pastEventsMax: 2000,
	formatMin: 2,
	formatMax: 80,
	regionMin: 2,
	regionMax: 80,
	frequencyMin: 2,
	frequencyMax: 80,
	playerCountMin: 2,
	playerCountMax: 10000,
	noteMax: 2000
} as const;

export class OrganizerApplicationError extends Error {
	readonly statusCode: number;
	constructor(message: string, statusCode = 400) {
		super(message);
		this.name = 'OrganizerApplicationError';
		this.statusCode = statusCode;
	}
}

export interface OrganizerApplicationInput {
	discordHandle: string;
	pastEvents: string;
	format: string;
	region: string;
	frequency: string;
	expectedPlayerCount: number;
}

export interface ValidatedOrganizerApplication {
	discordHandle: string;
	pastEvents: string;
	format: string;
	region: string;
	frequency: string;
	expectedPlayerCount: number;
}

export interface OrganizerApplicationRecord {
	id: string;
	userId: string;
	applicantName: string;
	discordHandle: string;
	pastEvents: string;
	format: string;
	region: string;
	frequency: string;
	expectedPlayerCount: number;
	status: OrganizerApplicationStatus;
	reviewNote: string | null;
	reviewedAt: string | null;
	createdAt: string;
}

export interface OrganizerApplicationState {
	available: boolean;
	steamLinked: boolean;
	isOrganizer: boolean;
	application: OrganizerApplicationRecord | null;
	canApply: boolean;
	blockedReason: string | null;
	reapplyAt: string | null;
}

export interface ApplicationEligibilityInput {
	steamLinked: boolean;
	isOrganizer: boolean;
	hasPending: boolean;
	latestRejectedAt: string | null;
	now?: Date;
}

interface ApplicationRow {
	id: string;
	user_id: string;
	discord_handle: string;
	past_events: string;
	event_format: string;
	region: string;
	frequency: string;
	expected_player_count: number;
	status: OrganizerApplicationStatus;
	review_note: string | null;
	reviewed_at: string | null;
	created_at: string;
	applicant?: { display_name: string | null } | { display_name: string | null }[] | null;
}

const APPLICATION_COLUMNS =
	'id, user_id, discord_handle, past_events, event_format, region, frequency, expected_player_count, status, review_note, reviewed_at, created_at, applicant:profiles!organizer_applications_user_id_fkey(display_name)';

function requireAdminClient() {
	const admin = getSupabaseAdminClient();
	if (!admin) {
		throw new OrganizerApplicationError(
			'Organizer applications require SUPABASE_SERVICE_ROLE_KEY to be configured.',
			503
		);
	}
	return admin;
}

function one<T>(value: T | T[] | null | undefined): T | null {
	if (Array.isArray(value)) return value[0] ?? null;
	return value ?? null;
}

function toRecord(row: ApplicationRow): OrganizerApplicationRecord {
	return {
		id: row.id,
		userId: row.user_id,
		applicantName: one(row.applicant)?.display_name ?? '',
		discordHandle: row.discord_handle,
		pastEvents: row.past_events,
		format: row.event_format,
		region: row.region,
		frequency: row.frequency,
		expectedPlayerCount: row.expected_player_count,
		status: row.status,
		reviewNote: row.review_note,
		reviewedAt: row.reviewed_at,
		createdAt: row.created_at
	};
}

function requireText(value: string, label: string, min: number, max: number) {
	const trimmed = value.trim();
	if (trimmed.length < min) {
		throw new OrganizerApplicationError(`${label} must be at least ${min} characters.`, 422);
	}
	if (trimmed.length > max) {
		throw new OrganizerApplicationError(`${label} must be ${max} characters or fewer.`, 422);
	}
	return trimmed;
}

export function validateOrganizerApplicationInput(
	input: OrganizerApplicationInput
): ValidatedOrganizerApplication {
	const limits = ORGANIZER_APPLICATION_LIMITS;
	const discordHandle = requireText(input.discordHandle, 'Discord handle', limits.discordMin, limits.discordMax);
	const pastEvents = input.pastEvents.trim();
	if (!pastEvents) {
		throw new OrganizerApplicationError('Past events or community links are required.', 422);
	}
	if (pastEvents.length > limits.pastEventsMax) {
		throw new OrganizerApplicationError(
			`Past events must be ${limits.pastEventsMax} characters or fewer.`,
			422
		);
	}
	const format = requireText(input.format, 'Format', limits.formatMin, limits.formatMax);
	const region = requireText(input.region, 'Region', limits.regionMin, limits.regionMax);
	const frequency = requireText(input.frequency, 'Frequency', limits.frequencyMin, limits.frequencyMax);
	const count = input.expectedPlayerCount;
	if (!Number.isInteger(count) || count < limits.playerCountMin || count > limits.playerCountMax) {
		throw new OrganizerApplicationError(
			`Expected player count must be a whole number from ${limits.playerCountMin} to ${limits.playerCountMax}.`,
			422
		);
	}
	return { discordHandle, pastEvents, format, region, frequency, expectedPlayerCount: count };
}

export function reapplyAvailableAt(rejectedAtIso: string): Date {
	return new Date(Date.parse(rejectedAtIso) + ORGANIZER_REAPPLY_AFTER_MS);
}

export function rejectionBlocksReapply(rejectedAtIso: string | null, now = new Date()): boolean {
	if (!rejectedAtIso) return false;
	const rejectedAt = Date.parse(rejectedAtIso);
	if (Number.isNaN(rejectedAt)) return true;
	return now.getTime() - rejectedAt < ORGANIZER_REAPPLY_AFTER_MS;
}

/**
 * Steam is required, only one application can be waiting, and a rejection
 * blocks a new application for 30 days. Already-approved organizers do not
 * apply again.
 */
export function assertApplicationEligibility(input: ApplicationEligibilityInput, now = input.now ?? new Date()) {
	if (!input.steamLinked) {
		throw new OrganizerApplicationError('Link Steam before applying to organize tournaments.', 403);
	}
	if (input.isOrganizer) {
		throw new OrganizerApplicationError('You already have organizer access.', 409);
	}
	if (input.hasPending) {
		throw new OrganizerApplicationError('You already have an application awaiting review.', 409);
	}
	if (rejectionBlocksReapply(input.latestRejectedAt, now) && input.latestRejectedAt) {
		const available = reapplyAvailableAt(input.latestRejectedAt);
		const when = available.toISOString().slice(0, 10);
		throw new OrganizerApplicationError(`You can apply again on ${when}.`, 429);
	}
}

export function assertOrganizerAdmin(role: string) {
	if (role !== 'admin') {
		throw new OrganizerApplicationError('Admin role required.', 403);
	}
}

function mapWriteError(error: { code?: string; message?: string } | null, fallback: string): never {
	const message = error?.message ?? '';
	if (error?.code === '23505' || message.includes('idx_organizer_applications_one_pending')) {
		throw new OrganizerApplicationError('You already have an application awaiting review.', 409);
	}
	if (message.includes('Steam must be linked')) {
		throw new OrganizerApplicationError('Link Steam before applying to organize tournaments.', 403);
	}
	if (message.includes('already granted')) {
		throw new OrganizerApplicationError('You already have organizer access.', 409);
	}
	if (message.includes('30 days')) {
		throw new OrganizerApplicationError('You can apply again 30 days after a rejection.', 429);
	}
	console.error('[organizer-applications]', fallback, error);
	throw new OrganizerApplicationError(fallback, 500);
}

export async function submitOrganizerApplication(
	userId: string,
	input: OrganizerApplicationInput,
	now = new Date()
): Promise<OrganizerApplicationRecord> {
	const validated = validateOrganizerApplicationInput(input);
	const admin = requireAdminClient();

	const { data: profile, error: profileError } = await admin
		.from('profiles')
		.select('verified_steam_id, is_tournament_organizer')
		.eq('id', userId)
		.maybeSingle<{ verified_steam_id: string | null; is_tournament_organizer: boolean | null }>();
	if (profileError) {
		console.error('[organizer-applications] profile lookup failed', profileError);
		throw new OrganizerApplicationError('Could not check organizer eligibility.', 500);
	}
	if (!profile) throw new OrganizerApplicationError('Profile not found.', 404);

	const { data: latest, error: latestError } = await admin
		.from('organizer_applications')
		.select('status, reviewed_at')
		.eq('user_id', userId)
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle<{ status: OrganizerApplicationStatus; reviewed_at: string | null }>();
	if (latestError) {
		console.error('[organizer-applications] eligibility lookup failed', latestError);
		throw new OrganizerApplicationError('Could not check organizer eligibility.', 500);
	}

	assertApplicationEligibility(
		{
			steamLinked: Boolean(profile.verified_steam_id),
			isOrganizer: Boolean(profile.is_tournament_organizer),
			hasPending: latest?.status === 'pending',
			latestRejectedAt: latest?.status === 'rejected' ? (latest.reviewed_at ?? null) : null
		},
		now
	);

	const { data, error } = await admin
		.from('organizer_applications')
		.insert({
			user_id: userId,
			discord_handle: validated.discordHandle,
			past_events: validated.pastEvents,
			event_format: validated.format,
			region: validated.region,
			frequency: validated.frequency,
			expected_player_count: validated.expectedPlayerCount,
			status: 'pending'
		})
		.select(APPLICATION_COLUMNS)
		.single<ApplicationRow>();
	if (error || !data) mapWriteError(error, 'Could not submit the application.');
	return toRecord(data);
}

export async function loadOrganizerApplicationState(userId: string): Promise<OrganizerApplicationState> {
	const unavailable: OrganizerApplicationState = {
		available: false,
		steamLinked: false,
		isOrganizer: false,
		application: null,
		canApply: false,
		blockedReason: 'Organizer applications are not available on this deployment yet.',
		reapplyAt: null
	};
	const admin = getSupabaseAdminClient();
	if (!admin) return unavailable;

	const [{ data: profile, error: profileError }, { data: latest, error: latestError }] =
		await Promise.all([
			admin
				.from('profiles')
				.select('verified_steam_id, is_tournament_organizer')
				.eq('id', userId)
				.maybeSingle<{ verified_steam_id: string | null; is_tournament_organizer: boolean | null }>(),
			admin
				.from('organizer_applications')
				.select(APPLICATION_COLUMNS)
				.eq('user_id', userId)
				.order('created_at', { ascending: false })
				.limit(1)
				.maybeSingle<ApplicationRow>()
		]);

	if (profileError) {
		console.error('[organizer-applications] state profile lookup failed', profileError);
		return unavailable;
	}
	if (latestError && /organizer_applications|schema cache|does not exist/i.test(latestError.message ?? '')) {
		return unavailable;
	}
	if (latestError) {
		console.error('[organizer-applications] state lookup failed', latestError);
		return unavailable;
	}

	const steamLinked = Boolean(profile?.verified_steam_id);
	const isOrganizer = Boolean(profile?.is_tournament_organizer);
	const application = latest ? toRecord(latest) : null;
	const latestRejectedAt = application?.status === 'rejected' ? application.reviewedAt : null;
	const blocked = rejectionBlocksReapply(latestRejectedAt);
	let blockedReason: string | null = null;
	let canApply = false;
	try {
		assertApplicationEligibility({
			steamLinked,
			isOrganizer,
			hasPending: application?.status === 'pending',
			latestRejectedAt
		});
		canApply = true;
	} catch (err) {
		blockedReason = err instanceof OrganizerApplicationError ? err.message : 'You cannot apply right now.';
	}

	return {
		available: true,
		steamLinked,
		isOrganizer,
		application,
		canApply,
		blockedReason,
		reapplyAt: blocked && latestRejectedAt ? reapplyAvailableAt(latestRejectedAt).toISOString() : null
	};
}

export async function listPendingOrganizerApplications(): Promise<OrganizerApplicationRecord[]> {
	const admin = requireAdminClient();
	const { data, error } = await admin
		.from('organizer_applications')
		.select(APPLICATION_COLUMNS)
		.eq('status', 'pending')
		.order('created_at', { ascending: true });
	if (error) {
		console.error('[organizer-applications] list pending failed', error);
		throw new OrganizerApplicationError('Could not load organizer applications.', 500);
	}
	return ((data as ApplicationRow[] | null) ?? []).map(toRecord);
}

export async function countPendingOrganizerApplications(): Promise<number> {
	const admin = getSupabaseAdminClient();
	if (!admin) return 0;
	const { count, error } = await admin
		.from('organizer_applications')
		.select('id', { head: true, count: 'exact' })
		.eq('status', 'pending');
	if (error) {
		if (!/organizer_applications|schema cache|does not exist/i.test(error.message ?? '')) {
			console.error('[organizer-applications] pending count failed', error);
		}
		return 0;
	}
	return count ?? 0;
}

function cleanNote(note: string | null | undefined) {
	const trimmed = note?.trim() || null;
	if (trimmed && trimmed.length > ORGANIZER_APPLICATION_LIMITS.noteMax) {
		throw new OrganizerApplicationError('Review note is too long.', 422);
	}
	return trimmed;
}

export async function reviewOrganizerApplication(
	applicationId: string,
	actor: { id: string; role: ProfileRole },
	decision: { decision: 'approve' | 'reject'; note?: string | null }
): Promise<OrganizerApplicationRecord> {
	assertOrganizerAdmin(actor.role);
	const admin = requireAdminClient();
	const note = cleanNote(decision.note);

	const { data: existing, error: lookupError } = await admin
		.from('organizer_applications')
		.select('id, user_id, status')
		.eq('id', applicationId)
		.maybeSingle<{ id: string; user_id: string; status: OrganizerApplicationStatus }>();
	if (lookupError) {
		console.error('[organizer-applications] review lookup failed', lookupError);
		throw new OrganizerApplicationError('Could not load the application.', 500);
	}
	if (!existing) throw new OrganizerApplicationError('Application not found.', 404);
	if (existing.status !== 'pending') {
		throw new OrganizerApplicationError(`Application was already ${existing.status}.`, 409);
	}

	const reviewedAt = new Date().toISOString();
	const nextStatus: OrganizerApplicationStatus = decision.decision === 'approve' ? 'approved' : 'rejected';
	const { data: updated, error: updateError } = await admin
		.from('organizer_applications')
		.update({
			status: nextStatus,
			review_note: note,
			reviewed_by: actor.id,
			reviewed_at: reviewedAt
		})
		.eq('id', applicationId)
		.eq('status', 'pending')
		.select(APPLICATION_COLUMNS)
		.maybeSingle<ApplicationRow>();
	if (updateError) mapWriteError(updateError, 'Could not record the decision.');
	if (!updated) throw new OrganizerApplicationError('Application was already reviewed.', 409);

	if (decision.decision === 'approve') {
		try {
			await setTournamentOrganizer(existing.user_id, true, { role: 'admin' });
		} catch (err) {
			await admin
				.from('organizer_applications')
				.update({
					status: 'pending',
					review_note: null,
					reviewed_by: null,
					reviewed_at: null
				})
				.eq('id', applicationId);
			console.error('[organizer-applications] organizer grant failed', err);
			throw new OrganizerApplicationError('Could not grant organizer access.', 500);
		}
	}

	return toRecord(updated);
}

/**
 * Turns organizer access off. Past tournaments stay; this never deletes them.
 */
export async function revokeOrganizerAccess(targetId: string, actor: { role: ProfileRole }) {
	assertOrganizerAdmin(actor.role);
	return setTournamentOrganizer(targetId, false, { role: 'admin' });
}

export interface ModerationTournament {
	id: string;
	slug: string;
	name: string;
	status: string;
	organizerId: string;
	organizerName: string;
	startsAt: string;
	unlistedAt: string | null;
}

export async function listTournamentsForModeration(): Promise<ModerationTournament[]> {
	const admin = requireAdminClient();
	const { data, error } = await admin
		.from('tournaments')
		.select('id, slug, name, status, organizer_id, starts_at, unlisted_at, organizer:profiles!tournaments_organizer_id_fkey(display_name)')
		.neq('status', 'draft')
		.order('starts_at', { ascending: false })
		.limit(100);
	if (error) {
		console.error('[organizer-applications] moderation tournaments failed', error);
		throw new OrganizerApplicationError('Could not load tournaments.', 500);
	}
	return ((data as {
		id: string;
		slug: string;
		name: string;
		status: string;
		organizer_id: string;
		starts_at: string;
		unlisted_at: string | null;
		organizer?: { display_name: string | null } | { display_name: string | null }[] | null;
	}[]) ?? []).map((row) => ({
		id: row.id,
		slug: row.slug,
		name: row.name,
		status: row.status,
		organizerId: row.organizer_id,
		organizerName: one(row.organizer)?.display_name ?? '',
		startsAt: row.starts_at,
		unlistedAt: row.unlisted_at
	}));
}

export async function unlistTournament(
	tournamentId: string,
	actor: { id: string; role: ProfileRole },
	note?: string | null
) {
	assertOrganizerAdmin(actor.role);
	const admin = requireAdminClient();
	const unlistNote = note?.trim() || null;
	if (unlistNote && unlistNote.length > 500) {
		throw new OrganizerApplicationError('Unlist note must be 500 characters or fewer.', 422);
	}

	const { data: existing, error: lookupError } = await admin
		.from('tournaments')
		.select('id, unlisted_at')
		.eq('id', tournamentId)
		.maybeSingle<{ id: string; unlisted_at: string | null }>();
	if (lookupError) {
		console.error('[organizer-applications] unlist lookup failed', lookupError);
		throw new OrganizerApplicationError('Could not load the tournament.', 500);
	}
	if (!existing) throw new OrganizerApplicationError('Tournament not found.', 404);
	if (existing.unlisted_at) return { id: existing.id, unlistedAt: existing.unlisted_at };

	const unlistedAt = new Date().toISOString();
	const { data, error } = await admin
		.from('tournaments')
		.update({
			unlisted_at: unlistedAt,
			unlisted_by: actor.id,
			unlist_note: unlistNote
		})
		.eq('id', tournamentId)
		.select('id')
		.maybeSingle<{ id: string }>();
	if (error || !data) {
		console.error('[organizer-applications] unlist failed', error);
		throw new OrganizerApplicationError('Could not unlist the tournament.', 500);
	}
	return { id: data.id, unlistedAt };
}

export async function listOrganizerProfiles(): Promise<{ id: string; displayName: string }[]> {
	const admin = requireAdminClient();
	const { data, error } = await admin
		.from('profiles')
		.select('id, display_name')
		.eq('is_tournament_organizer', true)
		.order('display_name', { ascending: true });
	if (error) {
		console.error('[organizer-applications] organizer list failed', error);
		throw new OrganizerApplicationError('Could not load organizers.', 500);
	}
	return ((data as { id: string; display_name: string | null }[]) ?? []).map((row) => ({
		id: row.id,
		displayName: row.display_name ?? ''
	}));
}
