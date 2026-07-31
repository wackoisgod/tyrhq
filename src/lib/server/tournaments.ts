import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { getSnakeFirstRoundSeeds } from '$lib/tournaments/bracket';

import {
	assertTeamNameAllowed,
	TournamentError,
	findBlockedTeamNameTerm
} from './tournament-safety';
import {
	MAX_UPLOAD_BYTES,
	MAX_UPLOAD_DIMENSION,
	readImageMetadata
} from './article-uploads';
import { getSupabaseAdminClient } from './supabase-admin';

export { TournamentError, findBlockedTeamNameTerm };

const TEAM_NAME_MAX = 40;
const TEAM_DESCRIPTION_MAX = 500;
const TOURNAMENT_NAME_MAX = 120;
const TOURNAMENT_SUMMARY_MAX = 500;
const URL_MAX = 500;
const LOGO_BUCKET = 'tournament-images';
const TYR_TEAM_SIZE = 8;
const SUPPORTED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const EXT_BY_MIME: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif'
};

const urlSchema = z
	.string()
	.trim()
	.max(URL_MAX)
	.url('Must be a valid URL')
	.optional()
	.or(z.literal('').transform(() => undefined));

export const createTeamSchema = z
	.object({
		name: z.string().trim().min(3).max(TEAM_NAME_MAX),
		description: z.string().trim().max(TEAM_DESCRIPTION_MAX).optional()
	})
	.strict();

export const updateTeamSchema = createTeamSchema;

export const createTournamentSchema = z
	.object({
		name: z.string().trim().min(3).max(TOURNAMENT_NAME_MAX),
		summary: z.string().trim().max(TOURNAMENT_SUMMARY_MAX).optional(),
		startsAt: z.string().datetime({ offset: true }),
		registrationClosesAt: z.string().datetime({ offset: true }).optional().or(z.literal('')),
		registrationMode: z.enum(['open', 'manual_bracket']),
		teamSize: z.literal(TYR_TEAM_SIZE),
		substituteCount: z.number().int().min(0).max(16),
		rulesUrl: urlSchema,
		discordUrl: urlSchema
	})
	.strict()
	.superRefine((body, ctx) => {
		if (body.registrationClosesAt && body.registrationClosesAt >= body.startsAt) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['registrationClosesAt'],
				message: 'Registration must close before the tournament starts'
			});
		}
	});

export const updateTournamentSchema = createTournamentSchema.extend({
	status: z.enum(['draft', 'open', 'in_progress', 'completed', 'cancelled'])
});

export const resultSchema = z
	.object({
		matchId: z.string().uuid(),
		scoreA: z.number().int().min(0).max(999),
		scoreB: z.number().int().min(0).max(999),
		winnerTeamId: z.string().uuid()
	})
	.strict();

export const seedOrderSchema = z
	.array(z.string().uuid())
	.min(1, 'Add at least one team before saving the ranking')
	.max(256, 'A tournament cannot contain more than 256 teams')
	.refine((teamIds) => new Set(teamIds).size === teamIds.length, 'Each team can only appear once');

export const reopenRegistrationSchema = z
	.object({
		closesAt: z.string().datetime({ offset: true })
	})
	.strict();

export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;
export type UpdateTournamentInput = z.infer<typeof updateTournamentSchema>;

interface ProfileRef {
	id: string;
	display_name: string | null;
}

interface TeamRow {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	logo_url: string | null;
	captain_id: string;
	is_disabled: boolean;
	created_at: string;
	updated_at: string;
	captain?: ProfileRef | ProfileRef[] | null;
}

interface MemberRow {
	team_id: string;
	user_id: string;
	role: 'captain' | 'member';
	joined_at: string;
	profile?: ProfileRef | ProfileRef[] | null;
}

interface JoinRequestRow {
	team_id: string;
	user_id: string;
	status: 'pending' | 'approved' | 'rejected';
	requested_at: string;
	reviewed_at: string | null;
	reviewed_by: string | null;
	profile?: ProfileRef | ProfileRef[] | null;
}

interface TournamentRow {
	id: string;
	slug: string;
	name: string;
	summary: string | null;
	logo_url: string | null;
	organizer_id: string;
	starts_at: string;
	registration_closes_at: string | null;
	registration_mode: 'open' | 'manual_bracket';
	status: 'draft' | 'open' | 'in_progress' | 'completed' | 'cancelled';
	team_size: number;
	substitute_count: number;
	rules_url: string | null;
	discord_url: string | null;
	created_at: string;
	updated_at: string;
	organizer?: ProfileRef | ProfileRef[] | null;
}

interface RegistrationRow {
	tournament_id: string;
	team_id: string;
	status: 'registered' | 'checked_in' | 'withdrawn';
	seed: number | null;
	registered_at: string;
	team?: TeamRow | TeamRow[] | null;
}

interface MatchRow {
	id: string;
	tournament_id: string;
	round: number;
	match_number: number;
	team_a_id: string | null;
	team_b_id: string | null;
	score_a: number;
	score_b: number;
	winner_team_id: string | null;
	status: 'pending' | 'completed';
	completed_at: string | null;
	best_of: number;
	scheduled_at: string | null;
	stream_url: string | null;
	notes: string | null;
	team_a?: TeamRow | TeamRow[] | null;
	team_b?: TeamRow | TeamRow[] | null;
	winner?: TeamRow | TeamRow[] | null;
}

export interface TournamentFinish {
	tier: 'champion' | 'runner_up' | 'semifinalist' | 'quarterfinalist' | 'eliminated' | 'active' | 'registered' | 'cancelled' | 'unknown';
	label: string;
	placementLabel: string | null;
	placementStart: number | null;
	placementEnd: number | null;
	wins: number;
	losses: number;
}

type TournamentFinishMatch = Pick<
	MatchRow,
	'round' | 'team_a_id' | 'team_b_id' | 'winner_team_id' | 'status'
>;

function one<T>(value: T | T[] | null | undefined): T | null {
	return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export function slugify(value: string) {
	return (
		value
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 64) || 'entry'
	);
}

function ordinal(value: number) {
	const remainder100 = value % 100;
	if (remainder100 >= 11 && remainder100 <= 13) return `${value}th`;
	if (value % 10 === 1) return `${value}st`;
	if (value % 10 === 2) return `${value}nd`;
	if (value % 10 === 3) return `${value}rd`;
	return `${value}th`;
}

function placementLabel(start: number, end: number) {
	return start === end ? `${ordinal(start)} place` : `${ordinal(start)}–${ordinal(end)} place`;
}

export function summarizeSingleEliminationFinish(
	teamId: string,
	tournamentStatus: TournamentRow['status'],
	matches: TournamentFinishMatch[]
): TournamentFinish {
	const teamMatches = matches.filter(
		(match) => match.team_a_id === teamId || match.team_b_id === teamId
	);
	const playedMatches = teamMatches.filter(
		(match) =>
			match.status === 'completed' &&
			Boolean(match.winner_team_id) &&
			Boolean(match.team_a_id) &&
			Boolean(match.team_b_id)
	);
	const wins = playedMatches.filter((match) => match.winner_team_id === teamId).length;
	const losses = playedMatches.filter((match) => match.winner_team_id !== teamId).length;
	const result = (finish: Omit<TournamentFinish, 'wins' | 'losses'>): TournamentFinish => ({
		...finish,
		wins,
		losses
	});

	if (tournamentStatus === 'cancelled') {
		return result({ tier: 'cancelled', label: 'Cancelled', placementLabel: null, placementStart: null, placementEnd: null });
	}

	const totalRounds = matches.reduce((highest, match) => Math.max(highest, match.round), 0);
	if (totalRounds === 0) {
		return result({ tier: 'registered', label: 'Registered', placementLabel: null, placementStart: null, placementEnd: null });
	}

	const finalWin = teamMatches.some(
		(match) =>
			match.round === totalRounds &&
			match.status === 'completed' &&
			match.winner_team_id === teamId
	);
	if (finalWin) {
		return result({ tier: 'champion', label: 'Tournament Champion', placementLabel: '1st place', placementStart: 1, placementEnd: 1 });
	}

	const loss = [...playedMatches]
		.filter((match) => match.winner_team_id !== teamId)
		.sort((a, b) => b.round - a.round)[0];
	if (loss) {
		const entrantCount = new Set(
			matches.flatMap((match) => [match.team_a_id, match.team_b_id]).filter((id): id is string => Boolean(id))
		).size;
		const placementStart = 2 ** (totalRounds - loss.round) + 1;
		const placementEnd = Math.max(
			placementStart,
			Math.min(2 ** (totalRounds - loss.round + 1), entrantCount || Number.POSITIVE_INFINITY)
		);
		let tier: TournamentFinish['tier'] = 'eliminated';
		let label = `Round of ${2 ** (totalRounds - loss.round + 1)}`;
		if (placementStart === 2) {
			tier = 'runner_up';
			label = 'Tournament Finalist';
		} else if (placementStart === 3) {
			tier = 'semifinalist';
			label = 'Semifinalist';
		} else if (placementStart === 5) {
			tier = 'quarterfinalist';
			label = 'Quarterfinalist';
		}
		return result({
			tier,
			label,
			placementLabel: placementLabel(placementStart, placementEnd),
			placementStart,
			placementEnd
		});
	}

	if (tournamentStatus === 'completed') {
		return result({ tier: 'unknown', label: 'Result unavailable', placementLabel: null, placementStart: null, placementEnd: null });
	}
	if (tournamentStatus === 'in_progress') {
		return result({ tier: 'active', label: 'Still competing', placementLabel: null, placementStart: null, placementEnd: null });
	}
	return result({ tier: 'registered', label: 'Registered', placementLabel: null, placementStart: null, placementEnd: null });
}

export function buildSingleEliminationRows(tournamentId: string, teamIds: string[]) {
	if (teamIds.length < 2) {
		throw new TournamentError('At least two teams are required.', 400);
	}
	const bracketSize = 2 ** Math.ceil(Math.log2(teamIds.length));
	const firstRoundMatchCount = bracketSize / 2;
	const firstRoundSlots = getSnakeFirstRoundSeeds(teamIds.length).map(
		([seedA, seedB]) =>
			[seedA ? teamIds[seedA - 1]! : null, seedB ? teamIds[seedB - 1]! : null] as const
	);
	const rounds = Math.log2(bracketSize);
	const rows: {
		tournament_id: string;
		round: number;
		match_number: number;
		team_a_id?: string | null;
		team_b_id?: string | null;
		winner_team_id?: string | null;
		status?: 'pending' | 'completed';
		completed_at?: string | null;
		best_of: number;
	}[] = [];

	for (let i = 0; i < firstRoundMatchCount; i++) {
		const [a, b] = firstRoundSlots[i];
		const byeWinner = a && !b ? a : b && !a ? b : null;
		rows.push({
			tournament_id: tournamentId,
			round: 1,
			match_number: i + 1,
			team_a_id: a,
			team_b_id: b,
			winner_team_id: byeWinner,
			status: a && b ? 'pending' : 'completed',
			completed_at: byeWinner ? new Date().toISOString() : null,
			best_of: rounds === 1 ? 7 : 5
		});
	}

	for (let round = 2; round <= rounds; round++) {
		for (let i = 0; i < bracketSize / 2 ** round; i++) {
			rows.push({
				tournament_id: tournamentId,
				round,
				match_number: i + 1,
				best_of: round === rounds ? 7 : 5
			});
		}
	}

	for (const match of rows) {
		if (match.round !== 1 || match.status !== 'completed' || !match.winner_team_id) continue;
		const next = rows.find(
			(row) => row.round === 2 && row.match_number === Math.ceil(match.match_number / 2)
		);
		if (!next) continue;
		if (match.match_number % 2 === 1) next.team_a_id = match.winner_team_id;
		else next.team_b_id = match.winner_team_id;
	}

	return rows;
}

async function uniqueSlug(admin: SupabaseClient, table: 'teams' | 'tournaments', name: string) {
	const base = slugify(name);
	for (let i = 0; i < 10; i++) {
		const slug = i === 0 ? base : `${base}-${i + 1}`;
		const { data, error } = await admin.from(table).select('id').eq('slug', slug).maybeSingle();
		if (error) throw new TournamentError('Could not reserve slug.', 500);
		if (!data) return slug;
	}
	return `${base}-${randomUUID().slice(0, 8)}`;
}

function requireAdminClient() {
	const admin = getSupabaseAdminClient();
	if (!admin) {
		throw new TournamentError('Tournament tools require SUPABASE_SERVICE_ROLE_KEY.', 503);
	}
	return admin;
}

function requireOrganizer(actor: { role: string; isOrganizer?: boolean | null }) {
	if (actor.role !== 'admin' && !actor.isOrganizer) {
		throw new TournamentError('Tournament organizer access required.', 403);
	}
}

function toTeam(row: TeamRow, members: MemberRow[] = [], record = { wins: 0, losses: 0 }) {
	const captain = one(row.captain);
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		description: row.description,
		logoUrl: row.logo_url,
		captainId: row.captain_id,
		captainName: captain?.display_name ?? '',
		isDisabled: row.is_disabled,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		record,
		members: members.map((member) => ({
			userId: member.user_id,
			role: member.role,
			joinedAt: member.joined_at,
			displayName: one(member.profile)?.display_name ?? ''
		}))
	};
}

function toTournament(row: TournamentRow) {
	const organizer = one(row.organizer);
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		summary: row.summary,
		logoUrl: row.logo_url,
		organizerId: row.organizer_id,
		organizerName: organizer?.display_name ?? '',
		startsAt: row.starts_at,
		registrationClosesAt: row.registration_closes_at,
		registrationMode: row.registration_mode,
		status: row.status,
		teamSize: row.team_size,
		substituteCount: row.substitute_count,
		maxTeamMembers: row.team_size + row.substitute_count,
		rulesUrl: row.rules_url,
		discordUrl: row.discord_url,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export async function loadOrganizerFlag(locals: App.Locals, userId: string) {
	const { data } = await locals.supabase
		.from('profiles')
		.select('is_tournament_organizer')
		.eq('id', userId)
		.maybeSingle<{ is_tournament_organizer: boolean | null }>();
	return Boolean(data?.is_tournament_organizer);
}

export async function listTeams() {
	const admin = requireAdminClient();
	const { data, error } = await admin
		.from('teams')
		.select('*, captain:profiles!teams_captain_id_fkey(id, display_name)')
		.eq('is_disabled', false)
		.order('created_at', { ascending: false });
	if (error) throw new TournamentError('Could not load teams.', 500);
	return ((data as TeamRow[]) ?? []).map((team) => toTeam(team));
}

export async function listCaptainTeams(userId: string) {
	const admin = requireAdminClient();
	const { data, error } = await admin
		.from('teams')
		.select('*, captain:profiles!teams_captain_id_fkey(id, display_name)')
		.eq('captain_id', userId)
		.eq('is_disabled', false)
		.order('created_at', { ascending: false });
	if (error) throw new TournamentError('Could not load your teams.', 500);
	return ((data as TeamRow[]) ?? []).map((team) => toTeam(team));
}

export async function getTeamBySlug(slug: string) {
	const admin = requireAdminClient();
	const { data: team, error } = await admin
		.from('teams')
		.select('*, captain:profiles!teams_captain_id_fkey(id, display_name)')
		.eq('slug', slug)
		.maybeSingle<TeamRow>();
	if (error) throw new TournamentError('Could not load team.', 500);
	if (!team || team.is_disabled) return null;

	const [{ data: members }, record, tournaments] = await Promise.all([
		admin
			.from('team_members')
			.select('team_id, user_id, role, joined_at, profile:profiles(id, display_name)')
			.eq('team_id', team.id)
			.order('joined_at', { ascending: true }),
		getTeamRecord(team.id),
		listTeamTournaments(team.id)
	]);

	return { ...toTeam(team, (members as MemberRow[]) ?? [], record), tournaments };
}

export async function createTeam(input: z.infer<typeof createTeamSchema>, actorId: string) {
	assertTeamNameAllowed(input.name);
	const admin = requireAdminClient();
	const { count, error: countError } = await admin
		.from('teams')
		.select('id', { head: true, count: 'exact' })
		.eq('captain_id', actorId)
		.eq('is_disabled', false);
	if (countError) throw new TournamentError('Could not check existing teams.', 500);
	if ((count ?? 0) > 0) {
		throw new TournamentError('You can only captain one active team.', 409);
	}

	const slug = await uniqueSlug(admin, 'teams', input.name);

	const { data: team, error } = await admin
		.from('teams')
		.insert({
			name: input.name,
			slug,
			description: input.description || null,
			captain_id: actorId
		})
		.select('*, captain:profiles!teams_captain_id_fkey(id, display_name)')
		.single<TeamRow>();
	if (error || !team) {
		throw new TournamentError('Could not create team. The name may already be taken.', 400);
	}

	const { error: memberError } = await admin.from('team_members').insert({
		team_id: team.id,
		user_id: actorId,
		role: 'captain'
	});
	if (memberError) throw new TournamentError('Could not create team roster.', 500);

	return toTeam(team);
}

export async function updateTeam(
	teamId: string,
	input: z.infer<typeof updateTeamSchema>,
	actorId: string,
	role: string
) {
	assertTeamNameAllowed(input.name);
	const admin = requireAdminClient();
	const { data: team } = await admin
		.from('teams')
		.select('captain_id')
		.eq('id', teamId)
		.maybeSingle<{ captain_id: string }>();
	if (!team) throw new TournamentError('Team not found.', 404);
	if (team.captain_id !== actorId && role !== 'admin') {
		throw new TournamentError('Only the team captain can edit this team.', 403);
	}

	const { error } = await admin
		.from('teams')
		.update({
			name: input.name,
			description: input.description || null
		})
		.eq('id', teamId);
	if (error) {
		throw new TournamentError('Could not update team. The name may already be taken.', 400);
	}
}

export async function getTeamJoinContext(teamId: string, actorId: string, role: string) {
	const admin = requireAdminClient();
	const [{ data: team, error: teamError }, { data: ownRequest, error: ownError }] =
		await Promise.all([
			admin
				.from('teams')
				.select('captain_id')
				.eq('id', teamId)
				.maybeSingle<{ captain_id: string }>(),
			admin
				.from('team_join_requests')
				.select('status')
				.eq('team_id', teamId)
				.eq('user_id', actorId)
				.maybeSingle<Pick<JoinRequestRow, 'status'>>()
		]);
	if (teamError || ownError) throw new TournamentError('Could not load team join requests.', 500);
	if (!team) throw new TournamentError('Team not found.', 404);

	const canManage = team.captain_id === actorId || role === 'admin';
	if (!canManage) {
		return { requestStatus: ownRequest?.status ?? null, pendingRequests: [] };
	}

	const { data: pending, error } = await admin
		.from('team_join_requests')
		.select('*, profile:profiles!team_join_requests_user_id_fkey(id, display_name)')
		.eq('team_id', teamId)
		.eq('status', 'pending')
		.order('requested_at', { ascending: true });
	if (error) throw new TournamentError('Could not load pending join requests.', 500);

	return {
		requestStatus: ownRequest?.status ?? null,
		pendingRequests: ((pending as JoinRequestRow[]) ?? []).map((request) => ({
			userId: request.user_id,
			displayName: one(request.profile)?.display_name ?? '',
			requestedAt: request.requested_at
		}))
	};
}

export async function requestTeamJoin(teamId: string, actorId: string) {
	const admin = requireAdminClient();
	const [
		{ data: team, error: teamError },
		{ data: membership, error: membershipError }
	] = await Promise.all([
		admin
			.from('teams')
			.select('id, is_disabled')
			.eq('id', teamId)
			.maybeSingle<{ id: string; is_disabled: boolean }>(),
		admin
			.from('team_members')
			.select('user_id')
			.eq('team_id', teamId)
			.eq('user_id', actorId)
			.maybeSingle<{ user_id: string }>()
	]);
	if (teamError || membershipError) throw new TournamentError('Could not request to join team.', 500);
	if (!team || team.is_disabled) throw new TournamentError('Team not found.', 404);
	if (membership) throw new TournamentError('You are already a member of this team.', 409);

	const { error } = await admin
		.from('team_join_requests')
		.upsert(
			{
				team_id: teamId,
				user_id: actorId,
				status: 'pending',
				requested_at: new Date().toISOString(),
				reviewed_at: null,
				reviewed_by: null
			},
			{ onConflict: 'team_id,user_id' }
		);
	if (error) throw new TournamentError('Could not request to join team.', 500);
}

export async function cancelTeamJoinRequest(teamId: string, actorId: string) {
	const admin = requireAdminClient();
	const { error } = await admin
		.from('team_join_requests')
		.delete()
		.eq('team_id', teamId)
		.eq('user_id', actorId)
		.eq('status', 'pending');
	if (error) throw new TournamentError('Could not cancel join request.', 500);
}

export async function reviewTeamJoinRequest(
	teamId: string,
	applicantId: string,
	decision: 'approve' | 'reject',
	actorId: string,
	role: string
) {
	const admin = requireAdminClient();
	const [{ data: team, error: teamError }, { data: request, error: requestError }] =
		await Promise.all([
			admin
				.from('teams')
				.select('captain_id, is_disabled')
				.eq('id', teamId)
				.maybeSingle<{ captain_id: string; is_disabled: boolean }>(),
			admin
				.from('team_join_requests')
				.select('status')
				.eq('team_id', teamId)
				.eq('user_id', applicantId)
				.maybeSingle<Pick<JoinRequestRow, 'status'>>()
		]);
	if (teamError || requestError) throw new TournamentError('Could not review join request.', 500);
	if (!team || team.is_disabled) throw new TournamentError('Team not found.', 404);
	if (team.captain_id !== actorId && role !== 'admin') {
		throw new TournamentError('Only the team captain can review join requests.', 403);
	}
	if (!request || request.status !== 'pending') {
		throw new TournamentError('This join request is no longer pending.', 409);
	}

	const reviewedAt = new Date().toISOString();
	const reviewedStatus = decision === 'approve' ? 'approved' : 'rejected';
	const { data: reviewed, error: reviewError } = await admin
		.from('team_join_requests')
		.update({
			status: reviewedStatus,
			reviewed_at: reviewedAt,
			reviewed_by: actorId
		})
		.eq('team_id', teamId)
		.eq('user_id', applicantId)
		.eq('status', 'pending')
		.select('user_id')
		.maybeSingle<{ user_id: string }>();
	if (reviewError) throw new TournamentError('Could not review join request.', 500);
	if (!reviewed) throw new TournamentError('This join request is no longer pending.', 409);

	if (decision === 'approve') {
		const { error: memberError } = await admin.from('team_members').upsert(
			{ team_id: teamId, user_id: applicantId, role: 'member' },
			{ onConflict: 'team_id,user_id' }
		);
		if (memberError) {
			await admin
				.from('team_join_requests')
				.update({ status: 'pending', reviewed_at: null, reviewed_by: null })
				.eq('team_id', teamId)
				.eq('user_id', applicantId)
				.eq('status', 'approved');
			throw new TournamentError('Could not add team member.', 500);
		}
	}
}

export async function updateTeamLogo(teamId: string, logoUrl: string, actorId: string, role: string) {
	const admin = requireAdminClient();
	const { data: team } = await admin
		.from('teams')
		.select('captain_id')
		.eq('id', teamId)
		.maybeSingle<{ captain_id: string }>();
	if (!team) throw new TournamentError('Team not found.', 404);
	if (team.captain_id !== actorId && role !== 'admin') {
		throw new TournamentError('Only the team captain can update the logo.', 403);
	}
	const { error } = await admin.from('teams').update({ logo_url: logoUrl }).eq('id', teamId);
	if (error) throw new TournamentError('Could not update team logo.', 500);
}

export async function leaveTeam(teamId: string, actorId: string) {
	const admin = requireAdminClient();
	const { data: member } = await admin
		.from('team_members')
		.select('role')
		.eq('team_id', teamId)
		.eq('user_id', actorId)
		.maybeSingle<{ role: 'captain' | 'member' }>();
	if (!member) return;
	if (member.role === 'captain') {
		throw new TournamentError('Captains cannot leave their team while they own it.', 409);
	}
	const { error } = await admin
		.from('team_members')
		.delete()
		.eq('team_id', teamId)
		.eq('user_id', actorId);
	if (error) throw new TournamentError('Could not leave team.', 500);
}

export async function listTournaments() {
	const admin = requireAdminClient();
	const { data, error } = await admin
		.from('tournaments')
		.select('*, organizer:profiles!tournaments_organizer_id_fkey(id, display_name)')
		.neq('status', 'draft')
		.order('starts_at', { ascending: true });
	if (error) throw new TournamentError('Could not load tournaments.', 500);
	const now = Date.now();
	const rows = ((data as TournamentRow[]) ?? []).map(toTournament);
	return {
		upcoming: rows.filter((t) => new Date(t.startsAt).getTime() >= now && t.status !== 'completed'),
		past: rows.filter((t) => new Date(t.startsAt).getTime() < now || t.status === 'completed')
	};
}

export async function listManagedTournaments(actorId: string, actor: { role: string; isOrganizer: boolean }) {
	requireOrganizer(actor);
	const admin = requireAdminClient();
	let query = admin
		.from('tournaments')
		.select('*, organizer:profiles!tournaments_organizer_id_fkey(id, display_name)')
		.order('starts_at', { ascending: false });
	if (actor.role !== 'admin') query = query.eq('organizer_id', actorId);
	const { data, error } = await query;
	if (error) throw new TournamentError('Could not load managed tournaments.', 500);
	return ((data as TournamentRow[]) ?? []).map(toTournament);
}

export async function getTournamentBySlug(slug: string, viewerId?: string | null, role = 'user') {
	const admin = requireAdminClient();
	const { data: tournament, error } = await admin
		.from('tournaments')
		.select('*, organizer:profiles!tournaments_organizer_id_fkey(id, display_name)')
		.eq('slug', slug)
		.maybeSingle<TournamentRow>();
	if (error) throw new TournamentError('Could not load tournament.', 500);
	if (!tournament) return null;
	const canManage = Boolean(viewerId && (viewerId === tournament.organizer_id || role === 'admin'));
	if (tournament.status === 'draft' && !canManage) return null;

	const [{ data: registrations }, { data: matches }] = await Promise.all([
		admin
			.from('tournament_registrations')
			.select('*, team:teams(*)')
			.eq('tournament_id', tournament.id)
			.neq('status', 'withdrawn')
			.order('seed', { ascending: true, nullsFirst: false })
			.order('registered_at', { ascending: true }),
		admin
			.from('tournament_matches')
			.select('*, team_a:teams!tournament_matches_team_a_id_fkey(*), team_b:teams!tournament_matches_team_b_id_fkey(*), winner:teams!tournament_matches_winner_team_id_fkey(*)')
			.eq('tournament_id', tournament.id)
			.order('round', { ascending: true })
			.order('match_number', { ascending: true })
	]);

	const normalizedRegistrations = ((registrations as RegistrationRow[]) ?? []).map((row) => ({
		teamId: row.team_id,
		status: row.status,
		seed: row.seed,
		registeredAt: row.registered_at,
		team: one(row.team) ? toTeam(one(row.team)!) : null
	}));

	return {
		...toTournament(tournament),
		canManage,
		registrations: normalizedRegistrations,
		matches: ((matches as MatchRow[]) ?? []).map((match) => ({
			id: match.id,
			round: match.round,
			matchNumber: match.match_number,
			scoreA: match.score_a,
			scoreB: match.score_b,
			winnerTeamId: match.winner_team_id,
			status: match.status,
			completedAt: match.completed_at,
			bestOf: match.best_of,
			scheduledAt: match.scheduled_at,
			streamUrl: match.stream_url,
			notes: match.notes,
			teamA: one(match.team_a) ? toTeam(one(match.team_a)!) : null,
			teamB: one(match.team_b) ? toTeam(one(match.team_b)!) : null,
			winner: one(match.winner) ? toTeam(one(match.winner)!) : null
		}))
	};
}

export async function createTournament(
	input: CreateTournamentInput,
	actorId: string,
	actor: { role: string; isOrganizer: boolean }
) {
	requireOrganizer(actor);
	const admin = requireAdminClient();
	const slug = await uniqueSlug(admin, 'tournaments', input.name);
	const { data, error } = await admin
		.from('tournaments')
		.insert({
			name: input.name,
			slug,
			summary: input.summary || null,
			organizer_id: actorId,
			starts_at: input.startsAt,
			registration_closes_at: input.registrationClosesAt || null,
			registration_mode: input.registrationMode,
			status: input.registrationMode === 'open' ? 'open' : 'draft',
			team_size: input.teamSize,
			substitute_count: input.substituteCount,
			rules_url: input.rulesUrl || null,
			discord_url: input.discordUrl || null
		})
		.select('*, organizer:profiles!tournaments_organizer_id_fkey(id, display_name)')
		.single<TournamentRow>();
	if (error || !data) throw new TournamentError('Could not create tournament.', 500);
	return toTournament(data);
}

export async function updateTournament(
	tournamentId: string,
	input: UpdateTournamentInput,
	actorId: string,
	role: string
) {
	await assertTournamentManager(tournamentId, actorId, role);
	const admin = requireAdminClient();
	const [{ data: current }, { data: existingMatch }] = await Promise.all([
		admin
			.from('tournaments')
			.select('status, registration_mode')
			.eq('id', tournamentId)
			.maybeSingle<Pick<TournamentRow, 'status' | 'registration_mode'>>(),
		admin
			.from('tournament_matches')
			.select('id')
			.eq('tournament_id', tournamentId)
			.limit(1)
			.maybeSingle<{ id: string }>()
	]);
	if (!current) throw new TournamentError('Tournament not found.', 404);
	if (existingMatch && input.status === 'open') {
		throw new TournamentError('Registration cannot be reopened after bracket generation.', 409);
	}
	if (existingMatch && input.registrationMode !== current.registration_mode) {
		throw new TournamentError('Registration mode cannot change after bracket generation.', 409);
	}
	if (current.status !== 'draft' && current.status !== 'open' && input.status === 'open') {
		throw new TournamentError('Cancelled or finished tournaments cannot reopen registration.', 409);
	}
	if (current.status !== 'open' && input.status === 'open') {
		if (new Date(input.startsAt).getTime() <= Date.now()) {
			throw new TournamentError('A tournament that has already started cannot reopen registration.', 409);
		}
		if (input.registrationClosesAt && new Date(input.registrationClosesAt).getTime() <= Date.now()) {
			throw new TournamentError('Choose a future registration deadline when reopening.', 400);
		}
	}
	const { data, error } = await admin
		.from('tournaments')
		.update({
			name: input.name,
			summary: input.summary || null,
			starts_at: input.startsAt,
			registration_closes_at: input.registrationClosesAt || null,
			registration_mode: input.registrationMode,
			status: input.status,
			team_size: input.teamSize,
			substitute_count: input.substituteCount,
			rules_url: input.rulesUrl || null,
			discord_url: input.discordUrl || null
		})
		.eq('id', tournamentId)
		.select('*, organizer:profiles!tournaments_organizer_id_fkey(id, display_name)')
		.single<TournamentRow>();
	if (error || !data) throw new TournamentError('Could not update tournament.', 500);
	return toTournament(data);
}

export async function updateTournamentLogo(
	tournamentId: string,
	logoUrl: string,
	actorId: string,
	role: string
) {
	await assertTournamentManager(tournamentId, actorId, role);
	const admin = requireAdminClient();
	const { error } = await admin
		.from('tournaments')
		.update({ logo_url: logoUrl })
		.eq('id', tournamentId);
	if (error) throw new TournamentError('Could not update tournament logo.', 500);
}

export async function reopenTournamentRegistration(
	tournamentId: string,
	closesAt: string,
	actorId: string,
	role: string
) {
	await assertTournamentManager(tournamentId, actorId, role);
	const parsed = reopenRegistrationSchema.safeParse({ closesAt });
	if (!parsed.success) throw new TournamentError('Choose a valid registration deadline.', 400);
	const admin = requireAdminClient();
	const [{ data: tournament }, { data: match }] = await Promise.all([
		admin
			.from('tournaments')
			.select('id, status, registration_mode, starts_at')
			.eq('id', tournamentId)
			.maybeSingle<{
				id: string;
				status: TournamentRow['status'];
				registration_mode: string;
				starts_at: string;
			}>(),
		admin
			.from('tournament_matches')
			.select('id')
			.eq('tournament_id', tournamentId)
			.limit(1)
			.maybeSingle<{ id: string }>()
	]);
	if (!tournament) throw new TournamentError('Tournament not found.', 404);
	if (tournament.registration_mode !== 'open') throw new TournamentError('This is not an open-registration tournament.', 409);
	if (tournament.status !== 'draft' && tournament.status !== 'open') {
		throw new TournamentError('Cancelled or finished tournaments cannot reopen registration.', 409);
	}
	if (match) throw new TournamentError('Registration cannot reopen after bracket generation.', 409);
	const deadline = new Date(parsed.data.closesAt).getTime();
	if (deadline <= Date.now()) throw new TournamentError('Registration deadline must be in the future.', 400);
	if (deadline >= new Date(tournament.starts_at).getTime()) {
		throw new TournamentError('Registration must close before the tournament starts.', 400);
	}
	const { error } = await admin
		.from('tournaments')
		.update({ status: 'open', registration_closes_at: parsed.data.closesAt })
		.eq('id', tournamentId);
	if (error) throw new TournamentError('Could not reopen registration.', 500);
}

export async function registerTeam(tournamentId: string, teamId: string, actorId: string) {
	const admin = requireAdminClient();
	const { error } = await admin.rpc('register_tournament_team', {
		p_tournament_id: tournamentId,
		p_team_id: teamId,
		p_registered_by: actorId,
		p_force: false
	});
	if (error) {
		if (error.message.includes('roster size')) {
			throw new TournamentError('Tournament roster must contain 8 players plus the allowed substitutes.', 400);
		}
		if (error.message.includes('captain')) throw new TournamentError('Only the team captain can register.', 403);
		if (error.message.includes('closed') || error.message.includes('locked')) {
			throw new TournamentError('Tournament registration is closed.', 409);
		}
		throw new TournamentError('Could not register team.', 500);
	}
}

export async function addTournamentTeam(tournamentId: string, teamId: string, actorId: string, role: string) {
	await assertTournamentManager(tournamentId, actorId, role);
	await assertSeedsEditable(tournamentId);
	const admin = requireAdminClient();
	const { data, error } = await admin.rpc('register_tournament_team', {
		p_tournament_id: tournamentId,
		p_team_id: teamId,
		p_registered_by: actorId,
		p_force: true
	});
	if (error) throw new TournamentError('Could not force register team.', 500);
	return Number(data ?? 0);
}

export async function removeTournamentTeam(
	tournamentId: string,
	teamId: string,
	actorId: string,
	role: string
) {
	await assertTournamentManager(tournamentId, actorId, role);
	await assertSeedsEditable(tournamentId);
	const admin = requireAdminClient();
	const { data, error } = await admin
		.from('tournament_registrations')
		.update({ status: 'withdrawn', seed: null })
		.eq('tournament_id', tournamentId)
		.eq('team_id', teamId)
		.neq('status', 'withdrawn')
		.select('team_id')
		.maybeSingle<{ team_id: string }>();
	if (error) throw new TournamentError('Could not remove team.', 500);
	if (!data) throw new TournamentError('Tournament team not found.', 404);
}

export async function saveTournamentSeeds(
	tournamentId: string,
	teamIds: string[],
	actorId: string,
	role: string
) {
	await assertTournamentManager(tournamentId, actorId, role);
	await assertSeedsEditable(tournamentId);
	const parsed = seedOrderSchema.safeParse(teamIds);
	if (!parsed.success) {
		throw new TournamentError(parsed.error.issues[0]?.message ?? 'Invalid ranking.', 400);
	}
	const admin = requireAdminClient();
	const { error } = await admin.rpc('replace_tournament_seeds', {
		p_tournament_id: tournamentId,
		p_team_ids: parsed.data
	});
	if (error) throw new TournamentError('Could not save ranking.', 500);
}

export async function generateBracket(tournamentId: string, actorId: string, role: string) {
	await assertTournamentManager(tournamentId, actorId, role);
	await assertSeedsEditable(tournamentId);
	const admin = requireAdminClient();
	const { data: registrations, error } = await admin
		.from('tournament_registrations')
		.select('team_id, seed, registered_at')
		.eq('tournament_id', tournamentId)
		.neq('status', 'withdrawn')
		.order('seed', { ascending: true, nullsFirst: false })
		.order('registered_at', { ascending: true });
	if (error) throw new TournamentError('Could not load seeds.', 500);

	const rankedRegistrations =
		(registrations as { team_id: string; seed: number | null }[] | null) ?? [];
	if (
		rankedRegistrations.length < 2 ||
		rankedRegistrations.some((registration, index) => registration.seed !== index + 1)
	) {
		throw new TournamentError('Save a complete ranking before generating the bracket.', 409);
	}
	const teams = rankedRegistrations.map((registration) => registration.team_id);

	const rows = buildSingleEliminationRows(tournamentId, teams);
	const { error: replaceError } = await admin.rpc('replace_tournament_bracket', {
		p_tournament_id: tournamentId,
		p_matches: rows
	});
	if (replaceError) throw new TournamentError('Could not create bracket.', 500);
}

export async function recordMatchResult(input: z.infer<typeof resultSchema>, actorId: string, role: string) {
	const admin = requireAdminClient();
	const { data: match } = await admin
		.from('tournament_matches')
		.select('id, tournament_id, round, match_number, team_a_id, team_b_id, best_of')
		.eq('id', input.matchId)
		.maybeSingle<Pick<MatchRow, 'id' | 'tournament_id' | 'round' | 'match_number' | 'team_a_id' | 'team_b_id' | 'best_of'>>();
	if (!match) throw new TournamentError('Match not found.', 404);
	await assertTournamentManager(match.tournament_id, actorId, role);
	if (input.winnerTeamId !== match.team_a_id && input.winnerTeamId !== match.team_b_id) {
		throw new TournamentError('Winner must be one of the match teams.', 400);
	}
	const winsRequired = Math.floor(match.best_of / 2) + 1;
	const winnerScore = input.winnerTeamId === match.team_a_id ? input.scoreA : input.scoreB;
	const loserScore = input.winnerTeamId === match.team_a_id ? input.scoreB : input.scoreA;
	if (winnerScore !== winsRequired || loserScore >= winsRequired) {
		throw new TournamentError(
			`A best-of-${match.best_of} result must end when the winner reaches ${winsRequired} games.`,
			400
		);
	}
	const { error } = await admin
		.from('tournament_matches')
		.update({
			score_a: input.scoreA,
			score_b: input.scoreB,
			winner_team_id: input.winnerTeamId,
			status: 'completed',
			completed_at: new Date().toISOString()
		})
		.eq('id', input.matchId);
	if (error) throw new TournamentError('Could not save result.', 500);

	await advanceWinner(match.tournament_id, match.round, match.match_number, input.winnerTeamId);
}

export async function uploadTournamentLogo(file: File | null, ownerId: string) {
	if (!file || file.size === 0) return null;
	if (file.size > MAX_UPLOAD_BYTES) {
		throw new TournamentError(`Logo is too large. Max ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)}MB.`, 413);
	}
	const bytes = new Uint8Array(await file.arrayBuffer());
	const meta = readImageMetadata(bytes);
	if (!meta || !SUPPORTED_MIME.has(meta.mime)) {
		throw new TournamentError('Logo must be PNG, JPEG, WebP, or GIF.', 400);
	}
	if (
		(meta.width !== null && meta.width > MAX_UPLOAD_DIMENSION) ||
		(meta.height !== null && meta.height > MAX_UPLOAD_DIMENSION)
	) {
		throw new TournamentError(`Logo dimensions exceed ${MAX_UPLOAD_DIMENSION}px on a side.`, 400);
	}
	const admin = requireAdminClient();
	const path = `${ownerId}/${randomUUID()}.${EXT_BY_MIME[meta.mime]}`;
	const { error } = await admin.storage.from(LOGO_BUCKET).upload(path, bytes, {
		contentType: meta.mime,
		upsert: false
	});
	if (error) throw new TournamentError('Could not upload logo.', 500);
	return admin.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
}

async function assertTournamentManager(tournamentId: string, actorId: string, role: string) {
	const admin = requireAdminClient();
	const { data } = await admin
		.from('tournaments')
		.select('organizer_id')
		.eq('id', tournamentId)
		.maybeSingle<{ organizer_id: string }>();
	if (!data) throw new TournamentError('Tournament not found.', 404);
	if (data.organizer_id !== actorId && role !== 'admin') {
		throw new TournamentError('Only the tournament organizer can manage this tournament.', 403);
	}
}

async function assertSeedsEditable(tournamentId: string) {
	const admin = requireAdminClient();
	const [{ data: tournament }, { data: match }] = await Promise.all([
		admin
			.from('tournaments')
			.select('status')
			.eq('id', tournamentId)
			.maybeSingle<{ status: TournamentRow['status'] }>(),
		admin
			.from('tournament_matches')
			.select('id')
			.eq('tournament_id', tournamentId)
			.limit(1)
			.maybeSingle<{ id: string }>()
	]);
	if (!tournament) throw new TournamentError('Tournament not found.', 404);
	if (match || tournament.status === 'in_progress' || tournament.status === 'completed') {
		throw new TournamentError('Seeds are locked after bracket generation.', 409);
	}
	if (tournament.status === 'cancelled') {
		throw new TournamentError('A cancelled tournament cannot be seeded.', 409);
	}
}

async function advanceWinner(tournamentId: string, round: number, matchNumber: number, winnerId: string) {
	const admin = requireAdminClient();
	const nextMatch = Math.ceil(matchNumber / 2);
	const slot = matchNumber % 2 === 1 ? 'team_a_id' : 'team_b_id';
	const { data: next } = await admin
		.from('tournament_matches')
		.select('id')
		.eq('tournament_id', tournamentId)
		.eq('round', round + 1)
		.eq('match_number', nextMatch)
		.maybeSingle<{ id: string }>();
	if (!next) {
		await admin.from('tournaments').update({ status: 'completed' }).eq('id', tournamentId);
		return;
	}
	await admin.from('tournament_matches').update({ [slot]: winnerId }).eq('id', next.id);
}


async function getTeamRecord(teamId: string) {
	const admin = requireAdminClient();
	const { data } = await admin
		.from('tournament_matches')
		.select('team_a_id, team_b_id, winner_team_id')
		.or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
		.eq('status', 'completed');
	let wins = 0;
	let losses = 0;
	for (const match of (data as Pick<MatchRow, 'team_a_id' | 'team_b_id' | 'winner_team_id'>[]) ?? []) {
		if (!match.winner_team_id) continue;
		if (match.winner_team_id === teamId) wins++;
		else losses++;
	}
	return { wins, losses };
}

async function listTeamTournaments(teamId: string) {
	const admin = requireAdminClient();
	const { data, error } = await admin
		.from('tournament_registrations')
		.select('status, seed, registered_at, tournament:tournaments(*)')
		.eq('team_id', teamId)
		.neq('status', 'withdrawn')
		.order('registered_at', { ascending: false });
	if (error) throw new TournamentError('Could not load team tournaments.', 500);

	const registrations =
		((data as (RegistrationRow & { tournament?: TournamentRow | TournamentRow[] | null })[]) ?? []);
	const tournamentIds = registrations
		.map((row) => one(row.tournament)?.id)
		.filter((id): id is string => Boolean(id));
	let matches: (TournamentFinishMatch & { tournament_id: string })[] = [];
	if (tournamentIds.length > 0) {
		const { data: matchData, error: matchError } = await admin
			.from('tournament_matches')
			.select('tournament_id, round, team_a_id, team_b_id, winner_team_id, status')
			.in('tournament_id', tournamentIds);
		if (matchError) throw new TournamentError('Could not load team tournament results.', 500);
		matches =
			(matchData as (TournamentFinishMatch & { tournament_id: string })[] | null) ?? [];
	}

	const matchesByTournament = new Map<string, TournamentFinishMatch[]>();
	for (const match of matches) {
		const bracket = matchesByTournament.get(match.tournament_id) ?? [];
		bracket.push(match);
		matchesByTournament.set(match.tournament_id, bracket);
	}

	return registrations
		.map((row) => {
			const tournament = one(row.tournament);
			return tournament
				? {
						status: row.status,
						seed: row.seed,
						result: summarizeSingleEliminationFinish(
							teamId,
							tournament.status,
							matchesByTournament.get(tournament.id) ?? []
						),
						tournament: toTournament(tournament)
					}
				: null;
		})
		.filter(
			(
				entry
			): entry is {
				status: RegistrationRow['status'];
				seed: number | null;
				result: TournamentFinish;
				tournament: ReturnType<typeof toTournament>;
			} => entry !== null
		);
}
