import { z } from 'zod';

import {
	buildReplayAutoFill,
	replayStatRows,
	type RegisteredPlayer,
	type ReplayAutoFill
} from '$lib/replay/auto-fill';
import { replayUploadPayloadSchema } from '$lib/replay/upload-payload.schema';
import type { ReplayPreview } from '$lib/replay/upload-payload';
import { getGameDataBundle } from '$lib/data/game-data';

import { getSupabaseAdminClient } from './supabase-admin';
import {
	getTournamentMatchDetail,
	matchGameSchema,
	saveTournamentMatchGame
} from './tournament-series';
import { TournamentError } from './tournaments';

export interface ReplayPreviewResult extends ReplayPreview {
	existingGameNumber: number | null;
	autoFill: ReplayAutoFill;
}

const acceptedUserIdsSchema = z.array(z.string().uuid()).max(32);

/**
 * Accept a browser-parsed replay. The .replay file is not read here.
 * Returns scoreboard suggestions and does not write.
 */
export async function previewReplayUpload(input: {
	tournamentId: string;
	matchId: string;
	actorId: string;
	role: string;
	payload: unknown;
}): Promise<ReplayPreviewResult> {
	const parsed = parsePayload(input.payload);
	const detail = await requireManagedMatch(input.tournamentId, input.matchId, input.actorId, input.role);
	const existing = await findReplayGuid(parsed.replayGuid);
	if (existing && existing.match_id !== input.matchId) {
		throw new TournamentError('This replay is already recorded on another match.', 409);
	}
	const players = await loadRegisteredPlayers(detail);
	return {
		payload: parsed,
		alreadyOnThisMatch: Boolean(existing),
		existingGameNumber: existing?.game_number ?? null,
		autoFill: buildReplayAutoFill({
			payload: parsed,
			teamAId: detail.match.teamA.id,
			teamBId: detail.match.teamB.id,
			players,
			vehicles: vehicleLookups()
		})
	};
}

/**
 * Save the confirmed winner, replay id, and checked player rows.
 * The organizer has to submit this separately from parsing.
 */
export async function confirmReplayUpload(input: {
	tournamentId: string;
	matchId: string;
	actorId: string;
	role: string;
	gameNumber: number;
	mapId: string;
	pickedByTeamId: string;
	winnerTeamId: string;
	vodUrl: string;
	notes: string;
	payload: unknown;
	acceptedUserIds: unknown;
}): Promise<string> {
	const parsed = parsePayload(input.payload);
	const accepted = acceptedUserIdsSchema.safeParse(input.acceptedUserIds);
	if (!accepted.success) throw new TournamentError('Choose players from the matched scoreboard.', 400);
	const detail = await requireManagedMatch(input.tournamentId, input.matchId, input.actorId, input.role);
	if (input.gameNumber > detail.match.bestOf) {
		throw new TournamentError(`This series is best-of-${detail.match.bestOf}.`, 400);
	}

	const players = await loadRegisteredPlayers(detail);
	const autoFill = buildReplayAutoFill({
		payload: parsed,
		teamAId: detail.match.teamA.id,
		teamBId: detail.match.teamB.id,
		players,
		vehicles: vehicleLookups()
	});
	const rows = replayStatRows(autoFill, accepted.data);
	const existing = await findReplayGuid(parsed.replayGuid);
	if (existing && (existing.match_id !== input.matchId || existing.game_number !== input.gameNumber)) {
		throw new TournamentError('This replay is already recorded on another game.', 409);
	}

	await assertStatsTable();
	const game = matchGameSchema.safeParse({
		matchId: input.matchId,
		gameNumber: input.gameNumber,
		mapId: input.mapId,
		pickedByTeamId: input.pickedByTeamId,
		winnerTeamId: input.winnerTeamId,
		vodUrl: input.vodUrl,
		notes: input.notes
	});
	if (!game.success) {
		throw new TournamentError(game.error.issues[0]?.message ?? 'Invalid game details.', 400);
	}

	const state = await saveTournamentMatchGame(game.data, input.actorId, input.role);
	const admin = requireAdmin();
	const { data: saved, error: savedError } = await admin
		.from('tournament_match_games')
		.select('id')
		.eq('match_id', input.matchId)
		.eq('game_number', input.gameNumber)
		.maybeSingle<{ id: string }>();
	if (savedError || !saved) throw new TournamentError('Could not save this replay.', 500);

	const { error: replayError } = await admin
		.from('tournament_match_games')
		.update({
			replay_guid: parsed.replayGuid,
			replay_changelist: parsed.changelist,
			replay_uploaded_at: new Date().toISOString(),
			replay_uploaded_by: input.actorId
		})
		.eq('id', saved.id);
	if (replayError) {
		if (replayError.code === '23505') {
			throw new TournamentError('This replay is already recorded on another game.', 409);
		}
		throw new TournamentError('Could not store the replay id.', 500);
	}

	const { error: deleteError } = await admin
		.from('tournament_game_player_stats')
		.delete()
		.eq('game_id', saved.id);
	if (deleteError) throw new TournamentError('Could not save replay stats.', 500);
	if (rows.length > 0) {
		const { error: insertError } = await admin.from('tournament_game_player_stats').insert(
			rows.map((row) => ({
				game_id: saved.id,
				user_id: row.userId,
				team_id: row.teamId,
				placement: row.placement,
				kills: row.kills,
				damage: row.damage,
				blocked: row.blocked,
				assist: row.assist,
				tank_codename: row.tankCodename,
				party_id: row.partyId
			}))
		);
		if (insertError) throw new TournamentError('Could not save replay stats.', 500);
	}

	return state.isComplete
		? 'Replay saved and the series is complete.'
		: `Replay saved. Series score is ${state.scoreA}-${state.scoreB}.`;
}

function parsePayload(payload: unknown) {
	const parsed = replayUploadPayloadSchema.safeParse(payload);
	if (!parsed.success) {
		throw new TournamentError(parsed.error.issues[0]?.message ?? 'Invalid replay data.', 400);
	}
	return parsed.data;
}

async function requireManagedMatch(
	tournamentId: string,
	matchId: string,
	actorId: string,
	role: string
) {
	const detail = await getTournamentMatchDetail(tournamentId, matchId, actorId, role);
	if (!detail.canManage) {
		throw new TournamentError('Only the tournament organizer can upload a replay.', 403);
	}
	if (!detail.match.teamA || !detail.match.teamB) {
		throw new TournamentError('Both teams must be known before uploading a replay.', 409);
	}
	return detail as typeof detail & {
		match: typeof detail.match & {
			teamA: NonNullable<typeof detail.match.teamA>;
			teamB: NonNullable<typeof detail.match.teamB>;
		};
	};
}

async function loadRegisteredPlayers(
	detail: Awaited<ReturnType<typeof getTournamentMatchDetail>>
): Promise<RegisteredPlayer[]> {
	const members = detail.rosters.flatMap((roster) =>
		roster.members.map((member) => ({
			userId: member.userId,
			teamId: roster.teamId,
			displayName: member.displayName
		}))
	);
	if (members.length === 0) return [];
	const admin = requireAdmin();
	const { data, error } = await admin
		.from('profiles')
		.select('id, verified_steam_id')
		.in(
			'id',
			members.map((member) => member.userId)
		);
	if (error) throw new TournamentError('Could not load registered players.', 500);
	const steamByUser = new Map(
		((data as { id: string; verified_steam_id: string | null }[] | null) ?? []).map((profile) => [
			profile.id,
			profile.verified_steam_id
		])
	);
	return members.map((member) => ({
		userId: member.userId,
		teamId: member.teamId,
		displayName: member.displayName,
		steamId: steamByUser.get(member.userId) ?? null
	}));
}

function vehicleLookups() {
	return getGameDataBundle().vehicles.map((vehicle) => ({
		id: vehicle.id,
		key: vehicle.key,
		name: vehicle.name
	}));
}

async function findReplayGuid(replayGuid: string) {
	const admin = requireAdmin();
	const { data, error } = await admin
		.from('tournament_match_games')
		.select('id, match_id, game_number')
		.eq('replay_guid', replayGuid)
		.maybeSingle<{ id: string; match_id: string; game_number: number }>();
	if (error) {
		if (error.code === '42703') throw new TournamentError('Replay tracking is not available yet.', 503);
		throw new TournamentError('Could not check this replay.', 500);
	}
	return data;
}

async function assertStatsTable() {
	const admin = requireAdmin();
	const { error } = await admin.from('tournament_game_player_stats').select('game_id').limit(0);
	if (!error) return;
	if (error.code === '42P01' || error.code === 'PGRST205') {
		throw new TournamentError('Apply migration 033_replay_player_stats.sql before saving replay stats.', 503);
	}
	throw new TournamentError('Could not save replay stats.', 500);
}

function requireAdmin() {
	const admin = getSupabaseAdminClient();
	if (!admin) throw new TournamentError('Tournament tools require SUPABASE_SERVICE_ROLE_KEY.', 503);
	return admin;
}
