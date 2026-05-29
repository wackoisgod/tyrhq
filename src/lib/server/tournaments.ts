import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

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
	team_a?: TeamRow | TeamRow[] | null;
	team_b?: TeamRow | TeamRow[] | null;
	winner?: TeamRow | TeamRow[] | null;
}

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

export function buildSingleEliminationRows(tournamentId: string, teamIds: string[]) {
	if (teamIds.length < 2) {
		throw new TournamentError('At least two teams are required.', 400);
	}
	const bracketSize = 2 ** Math.ceil(Math.log2(teamIds.length));
	const slots: (string | null)[] = [...teamIds, ...Array(bracketSize - teamIds.length).fill(null)];
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
	}[] = [];

	for (let i = 0; i < bracketSize / 2; i++) {
		const a = slots[i * 2];
		const b = slots[i * 2 + 1];
		const byeWinner = a && !b ? a : b && !a ? b : null;
		rows.push({
			tournament_id: tournamentId,
			round: 1,
			match_number: i + 1,
			team_a_id: a,
			team_b_id: b,
			winner_team_id: byeWinner,
			status: a && b ? 'pending' : 'completed',
			completed_at: byeWinner ? new Date().toISOString() : null
		});
	}

	for (let round = 2; round <= rounds; round++) {
		for (let i = 0; i < bracketSize / 2 ** round; i++) {
			rows.push({ tournament_id: tournamentId, round, match_number: i + 1 });
		}
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

export async function joinTeam(teamId: string, actorId: string) {
	const admin = requireAdminClient();
	const { data: team } = await admin
		.from('teams')
		.select('id, is_disabled')
		.eq('id', teamId)
		.maybeSingle<{ id: string; is_disabled: boolean }>();
	if (!team || team.is_disabled) throw new TournamentError('Team not found.', 404);

	const { error } = await admin
		.from('team_members')
		.upsert({ team_id: teamId, user_id: actorId, role: 'member' }, { onConflict: 'team_id,user_id' });
	if (error) throw new TournamentError('Could not join team.', 500);
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

export async function registerTeam(tournamentId: string, teamId: string, actorId: string) {
	const admin = requireAdminClient();
	const [{ data: tournament }, { data: team }, { count }] = await Promise.all([
		admin
			.from('tournaments')
			.select('id, status, registration_mode, registration_closes_at, team_size, substitute_count')
			.eq('id', tournamentId)
			.maybeSingle<{
				id: string;
				status: string;
				registration_mode: string;
				registration_closes_at: string | null;
				team_size: number;
				substitute_count: number;
			}>(),
		admin.from('teams').select('id, captain_id, is_disabled').eq('id', teamId).maybeSingle<{
			id: string;
			captain_id: string;
			is_disabled: boolean;
		}>(),
		admin
			.from('team_members')
			.select('user_id', { count: 'exact', head: true })
			.eq('team_id', teamId)
	]);
	if (!tournament || tournament.status !== 'open' || tournament.registration_mode !== 'open') {
		throw new TournamentError('This tournament is not open for registration.', 409);
	}
	if (tournament.registration_closes_at && new Date(tournament.registration_closes_at).getTime() < Date.now()) {
		throw new TournamentError('Registration is closed.', 409);
	}
	if (!team || team.is_disabled) throw new TournamentError('Team not found.', 404);
	if (team.captain_id !== actorId) throw new TournamentError('Only the team captain can register.', 403);
	const maxTeamMembers = tournament.team_size + tournament.substitute_count;
	if ((count ?? 0) < tournament.team_size || (count ?? 0) > maxTeamMembers) {
		throw new TournamentError(
			`Team must have ${tournament.team_size} players plus up to ${tournament.substitute_count} substitutes.`,
			400
		);
	}
	const { error } = await admin.from('tournament_registrations').upsert(
		{ tournament_id: tournamentId, team_id: teamId, registered_by: actorId, status: 'registered' },
		{ onConflict: 'tournament_id,team_id' }
	);
	if (error) throw new TournamentError('Could not register team.', 500);
}

export async function seedTeam(tournamentId: string, teamId: string, seed: number, actorId: string, role: string) {
	await assertTournamentManager(tournamentId, actorId, role);
	const admin = requireAdminClient();
	const { error } = await admin.from('tournament_registrations').upsert(
		{ tournament_id: tournamentId, team_id: teamId, seed, status: 'registered', registered_by: actorId },
		{ onConflict: 'tournament_id,team_id' }
	);
	if (error) throw new TournamentError('Could not seed team.', 500);
}

export async function generateBracket(tournamentId: string, actorId: string, role: string) {
	await assertTournamentManager(tournamentId, actorId, role);
	const admin = requireAdminClient();
	const { data: registrations, error } = await admin
		.from('tournament_registrations')
		.select('team_id, seed, registered_at')
		.eq('tournament_id', tournamentId)
		.neq('status', 'withdrawn')
		.order('seed', { ascending: true, nullsFirst: false })
		.order('registered_at', { ascending: true });
	if (error) throw new TournamentError('Could not load seeds.', 500);

	const teams = ((registrations as { team_id: string; seed: number | null }[]) ?? []).map(
		(r) => r.team_id
	);

	await admin.from('tournament_matches').delete().eq('tournament_id', tournamentId);
	const rows = buildSingleEliminationRows(tournamentId, teams);
	const { error: insertError } = await admin.from('tournament_matches').insert(rows);
	if (insertError) throw new TournamentError('Could not create bracket.', 500);
	await admin.from('tournaments').update({ status: 'in_progress' }).eq('id', tournamentId);

	await advanceCompletedByes(tournamentId);
}

export async function recordMatchResult(input: z.infer<typeof resultSchema>, actorId: string, role: string) {
	const admin = requireAdminClient();
	const { data: match } = await admin
		.from('tournament_matches')
		.select('id, tournament_id, round, match_number, team_a_id, team_b_id')
		.eq('id', input.matchId)
		.maybeSingle<Pick<MatchRow, 'id' | 'tournament_id' | 'round' | 'match_number' | 'team_a_id' | 'team_b_id'>>();
	if (!match) throw new TournamentError('Match not found.', 404);
	await assertTournamentManager(match.tournament_id, actorId, role);
	if (input.winnerTeamId !== match.team_a_id && input.winnerTeamId !== match.team_b_id) {
		throw new TournamentError('Winner must be one of the match teams.', 400);
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

async function advanceCompletedByes(tournamentId: string) {
	const admin = requireAdminClient();
	const { data } = await admin
		.from('tournament_matches')
		.select('round, match_number, winner_team_id')
		.eq('tournament_id', tournamentId)
		.eq('status', 'completed')
		.not('winner_team_id', 'is', null);
	for (const match of (data as { round: number; match_number: number; winner_team_id: string }[]) ?? []) {
		await advanceWinner(tournamentId, match.round, match.match_number, match.winner_team_id);
	}
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
	const { data } = await admin
		.from('tournament_registrations')
		.select('status, seed, tournament:tournaments(*)')
		.eq('team_id', teamId)
		.neq('status', 'withdrawn')
		.order('registered_at', { ascending: false });
	return ((data as (RegistrationRow & { tournament?: TournamentRow | TournamentRow[] | null })[]) ?? [])
		.map((row) => {
			const tournament = one(row.tournament);
			return tournament
				? { status: row.status, seed: row.seed, tournament: toTournament(tournament) }
				: null;
		})
		.filter(
			(
				entry
			): entry is {
				status: RegistrationRow['status'];
				seed: number | null;
				tournament: ReturnType<typeof toTournament>;
			} => entry !== null
		);
}
