import { z } from 'zod';

import { TournamentError } from './tournament-safety';
import { getSupabaseAdminClient } from './supabase-admin';

export const freeAgentProfileSchema = z
	.object({
		preferredRole: z.string().trim().max(80).optional(),
		note: z.string().trim().max(280).optional()
	})
	.strict();

interface TournamentWindowRow {
	id: string;
	status: 'draft' | 'open' | 'in_progress' | 'completed' | 'cancelled';
	registration_mode: 'open' | 'manual_bracket';
	starts_at: string;
	registration_closes_at: string | null;
	team_size: number;
	substitute_count: number;
}

interface ProfileRef {
	id: string;
	display_name: string | null;
}

interface FreeAgentRow {
	tournament_id: string;
	user_id: string;
	status: 'available' | 'placed' | 'withdrawn';
	preferred_role: string | null;
	note: string | null;
	registered_at: string;
	profile?: ProfileRef | ProfileRef[] | null;
}

interface TeamRef {
	id: string;
	slug: string;
	name: string;
	logo_url: string | null;
	captain_id: string;
}

interface RecruitmentRow {
	tournament_id: string;
	team_id: string;
	is_recruiting: boolean;
	team?: TeamRef | TeamRef[] | null;
}

interface RosterRow {
	team_id: string;
	user_id: string;
}

interface PickupRequestRow {
	tournament_id: string;
	team_id: string;
	user_id: string;
	status: 'pending' | 'approved' | 'rejected' | 'cancelled';
	requested_at: string;
}

function one<T>(value: T | T[] | null | undefined) {
	return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function requireAdminClient() {
	const admin = getSupabaseAdminClient();
	if (!admin) throw new TournamentError('Tournament tools require SUPABASE_SERVICE_ROLE_KEY.', 503);
	return admin;
}

async function requireOpenRegistration(tournamentId: string) {
	const admin = requireAdminClient();
	const [{ data: tournament, error }, { data: match }] = await Promise.all([
		admin
			.from('tournaments')
			.select('id, status, registration_mode, starts_at, registration_closes_at, team_size, substitute_count')
			.eq('id', tournamentId)
			.maybeSingle<TournamentWindowRow>(),
		admin
			.from('tournament_matches')
			.select('id')
			.eq('tournament_id', tournamentId)
			.limit(1)
			.maybeSingle<{ id: string }>()
	]);
	if (error || !tournament) throw new TournamentError('Tournament not found.', 404);
	if (
		tournament.status !== 'open' ||
		tournament.registration_mode !== 'open' ||
		new Date(tournament.starts_at).getTime() <= Date.now() ||
		Boolean(
			tournament.registration_closes_at &&
				new Date(tournament.registration_closes_at).getTime() <= Date.now()
		) ||
		match
	) {
		throw new TournamentError('Tournament registration is closed.', 409);
	}
	return tournament;
}

async function requireTeamCaptain(teamId: string, actorId: string, role: string) {
	const admin = requireAdminClient();
	const { data: team } = await admin
		.from('teams')
		.select('id, captain_id, is_disabled')
		.eq('id', teamId)
		.maybeSingle<{ id: string; captain_id: string; is_disabled: boolean }>();
	if (!team || team.is_disabled) throw new TournamentError('Team not found.', 404);
	if (team.captain_id !== actorId && role !== 'admin') {
		throw new TournamentError('Only the team captain can manage tournament recruiting.', 403);
	}
	return team;
}

export async function getTournamentFreeAgentContext(
	tournamentId: string,
	viewerId: string | null,
	captainTeamIds: string[]
) {
	const admin = requireAdminClient();
	const [freeAgentResult, recruitmentResult, rosterResult, registrationResult, requestResult, membershipResult] =
		await Promise.all([
			admin
				.from('tournament_free_agents')
				.select('*, profile:profiles(id, display_name)')
				.eq('tournament_id', tournamentId)
				.order('registered_at', { ascending: true }),
			admin
				.from('tournament_team_recruitment')
				.select('*, team:teams(id, slug, name, logo_url, captain_id)')
				.eq('tournament_id', tournamentId),
			admin
				.from('tournament_roster_members')
				.select('team_id, user_id')
				.eq('tournament_id', tournamentId),
			admin
				.from('tournament_registrations')
				.select('team_id')
				.eq('tournament_id', tournamentId)
				.neq('status', 'withdrawn'),
			viewerId
				? admin
						.from('tournament_free_agent_requests')
						.select('tournament_id, team_id, user_id, status, requested_at')
						.eq('tournament_id', tournamentId)
				: Promise.resolve({ data: [], error: null }),
			viewerId
				? admin.from('team_members').select('team_id').eq('user_id', viewerId).limit(1)
				: Promise.resolve({ data: [], error: null })
		]);

	if (
		freeAgentResult.error ||
		recruitmentResult.error ||
		rosterResult.error ||
		registrationResult.error ||
		requestResult.error ||
		membershipResult.error
	) {
		throw new TournamentError('Could not load tournament free agents.', 500);
	}

	const freeAgents = (freeAgentResult.data as FreeAgentRow[] | null) ?? [];
	const recruitment = (recruitmentResult.data as RecruitmentRow[] | null) ?? [];
	const roster = (rosterResult.data as RosterRow[] | null) ?? [];
	const registrations = (registrationResult.data as { team_id: string }[] | null) ?? [];
	const requests = (requestResult.data as PickupRequestRow[] | null) ?? [];
	const registeredTeamIds = new Set(registrations.map((registration) => registration.team_id));
	const captainTeamIdSet = new Set(captainTeamIds);
	const rosterCounts = new Map<string, number>();
	for (const member of roster) rosterCounts.set(member.team_id, (rosterCounts.get(member.team_id) ?? 0) + 1);
	const freeAgentsById = new Map(freeAgents.map((freeAgent) => [freeAgent.user_id, freeAgent]));
	const viewerRosterTeamId = viewerId
		? roster.find((member) => member.user_id === viewerId)?.team_id ?? null
		: null;
	const viewerRosterTeam = viewerRosterTeamId
		? one(recruitment.find((entry) => entry.team_id === viewerRosterTeamId)?.team)
		: null;

	const normalizeFreeAgent = (freeAgent: FreeAgentRow) => ({
		userId: freeAgent.user_id,
		displayName: one(freeAgent.profile)?.display_name ?? 'Unknown player',
		preferredRole: freeAgent.preferred_role ?? '',
		note: freeAgent.note ?? '',
		registeredAt: freeAgent.registered_at
	});

	return {
		freeAgents: freeAgents.filter((freeAgent) => freeAgent.status === 'available').map(normalizeFreeAgent),
		recruitingTeams: recruitment.flatMap((entry) => {
			const team = one(entry.team);
			if (!team || !entry.is_recruiting) return [];
			return [{
				teamId: team.id,
				slug: team.slug,
				name: team.name,
				logoUrl: team.logo_url,
				rosterCount: rosterCounts.get(team.id) ?? 0,
				isRegistered: registeredTeamIds.has(team.id)
			}];
		}),
		recruitingTeamIds: recruitment.filter((entry) => entry.is_recruiting).map((entry) => entry.team_id),
		rosterCounts: Object.fromEntries(rosterCounts),
		viewer: viewerId
			? {
				hasPermanentTeam: ((membershipResult.data as { team_id: string }[] | null) ?? []).length > 0,
				freeAgentStatus: freeAgentsById.get(viewerId)?.status ?? null,
				preferredRole: freeAgentsById.get(viewerId)?.preferred_role ?? '',
				note: freeAgentsById.get(viewerId)?.note ?? '',
				rosterTeamId: viewerRosterTeamId,
				rosterTeamName: viewerRosterTeam?.name ?? '',
				pendingTeamIds: requests
					.filter((request) => request.user_id === viewerId && request.status === 'pending')
					.map((request) => request.team_id)
			}
			: null,
		captainRequests: requests.flatMap((request) => {
			if (request.status !== 'pending' || !captainTeamIdSet.has(request.team_id)) return [];
			const freeAgent = freeAgentsById.get(request.user_id);
			if (!freeAgent) return [];
			return [{
				teamId: request.team_id,
				...normalizeFreeAgent(freeAgent),
				requestedAt: request.requested_at
			}];
		})
	};
}

export async function registerTournamentFreeAgent(
	tournamentId: string,
	actorId: string,
	input: z.infer<typeof freeAgentProfileSchema>
) {
	await requireOpenRegistration(tournamentId);
	const admin = requireAdminClient();
	const [{ data: membership }, { data: roster }, { data: existing }] = await Promise.all([
		admin.from('team_members').select('team_id').eq('user_id', actorId).limit(1),
		admin
			.from('tournament_roster_members')
			.select('team_id')
			.eq('tournament_id', tournamentId)
			.eq('user_id', actorId)
			.maybeSingle<{ team_id: string }>(),
		admin
			.from('tournament_free_agents')
			.select('status')
			.eq('tournament_id', tournamentId)
			.eq('user_id', actorId)
			.maybeSingle<{ status: FreeAgentRow['status'] }>()
	]);
	if ((membership as { team_id: string }[] | null)?.length) {
		throw new TournamentError('Only players who are not on a permanent team can enter the free-agent pool.', 409);
	}
	if (roster || existing?.status === 'placed') {
		throw new TournamentError('You have already been placed on a tournament roster.', 409);
	}
	const { error } = await admin.from('tournament_free_agents').upsert(
		{
			tournament_id: tournamentId,
			user_id: actorId,
			status: 'available',
			preferred_role: input.preferredRole || null,
			note: input.note || null,
			registered_at: new Date().toISOString()
		},
		{ onConflict: 'tournament_id,user_id' }
	);
	if (error) throw new TournamentError('Could not join the free-agent pool.', 500);
}

export async function withdrawTournamentFreeAgent(tournamentId: string, actorId: string) {
	await requireOpenRegistration(tournamentId);
	const admin = requireAdminClient();
	const { data, error } = await admin
		.from('tournament_free_agents')
		.delete()
		.eq('tournament_id', tournamentId)
		.eq('user_id', actorId)
		.eq('status', 'available')
		.select('user_id')
		.maybeSingle<{ user_id: string }>();
	if (error) throw new TournamentError('Could not leave the free-agent pool.', 500);
	if (!data) throw new TournamentError('You are not an available free agent.', 409);
}

export async function setTournamentTeamRecruiting(
	tournamentId: string,
	teamId: string,
	isRecruiting: boolean,
	actorId: string,
	role: string
) {
	await requireTeamCaptain(teamId, actorId, role);
	await requireOpenRegistration(tournamentId);
	const admin = requireAdminClient();
	const { data, error } = await admin.rpc('set_tournament_team_recruiting', {
		p_tournament_id: tournamentId,
		p_team_id: teamId,
		p_is_recruiting: isRecruiting
	});
	if (error) throw new TournamentError('Could not update tournament recruiting.', 500);
	return Number(data ?? 0);
}

export async function requestTournamentPickup(tournamentId: string, teamId: string, actorId: string) {
	await requireOpenRegistration(tournamentId);
	const admin = requireAdminClient();
	const [{ data: freeAgent }, { data: recruiting }, { data: membership }] = await Promise.all([
		admin
			.from('tournament_free_agents')
			.select('status')
			.eq('tournament_id', tournamentId)
			.eq('user_id', actorId)
			.maybeSingle<{ status: FreeAgentRow['status'] }>(),
		admin
			.from('tournament_team_recruitment')
			.select('is_recruiting')
			.eq('tournament_id', tournamentId)
			.eq('team_id', teamId)
			.maybeSingle<{ is_recruiting: boolean }>(),
		admin.from('team_members').select('team_id').eq('user_id', actorId).limit(1)
	]);
	if (freeAgent?.status !== 'available') throw new TournamentError('Join the free-agent pool first.', 409);
	if (!recruiting?.is_recruiting) throw new TournamentError('This team is not recruiting.', 409);
	if ((membership as { team_id: string }[] | null)?.length) {
		throw new TournamentError('Players on permanent teams cannot request a tournament pickup.', 409);
	}
	const { error } = await admin.from('tournament_free_agent_requests').upsert(
		{
			tournament_id: tournamentId,
			team_id: teamId,
			user_id: actorId,
			status: 'pending',
			requested_at: new Date().toISOString(),
			reviewed_at: null,
			reviewed_by: null
		},
		{ onConflict: 'tournament_id,team_id,user_id' }
	);
	if (error) throw new TournamentError('Could not request a tournament pickup.', 500);
}

export async function cancelTournamentPickupRequest(tournamentId: string, teamId: string, actorId: string) {
	const admin = requireAdminClient();
	const { error } = await admin
		.from('tournament_free_agent_requests')
		.update({ status: 'cancelled' })
		.eq('tournament_id', tournamentId)
		.eq('team_id', teamId)
		.eq('user_id', actorId)
		.eq('status', 'pending');
	if (error) throw new TournamentError('Could not cancel pickup request.', 500);
}

export async function reviewTournamentPickupRequest(
	tournamentId: string,
	teamId: string,
	freeAgentId: string,
	decision: 'approve' | 'reject',
	actorId: string,
	role: string
) {
	await requireTeamCaptain(teamId, actorId, role);
	await requireOpenRegistration(tournamentId);
	const admin = requireAdminClient();
	const { error } = await admin.rpc('review_tournament_free_agent_request', {
		p_tournament_id: tournamentId,
		p_team_id: teamId,
		p_user_id: freeAgentId,
		p_decision: decision,
		p_reviewed_by: actorId
	});
	if (error) throw new TournamentError('Could not review pickup request.', 500);
}
