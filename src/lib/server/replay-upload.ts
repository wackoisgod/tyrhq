import { replayUploadPayloadSchema } from '$lib/replay/upload-payload.schema';
import type { ReplayPreview } from '$lib/replay/upload-payload';

import { getSupabaseAdminClient } from './supabase-admin';
import { getTournamentMatchDetail } from './tournament-series';
import { TournamentError } from './tournaments';

/**
 * Accept a browser-parsed replay. The .replay file is never read here.
 * Nothing is written; the organizer reviews the result before a later save.
 */
export async function previewReplayUpload(input: {
	tournamentId: string;
	matchId: string;
	actorId: string;
	role: string;
	payload: unknown;
}): Promise<ReplayPreview> {
	const parsed = replayUploadPayloadSchema.safeParse(input.payload);
	if (!parsed.success) {
		throw new TournamentError(parsed.error.issues[0]?.message ?? 'Invalid replay data.', 400);
	}

	const detail = await getTournamentMatchDetail(
		input.tournamentId,
		input.matchId,
		input.actorId,
		input.role
	);
	if (!detail.canManage) {
		throw new TournamentError('Only the tournament organizer can upload a replay.', 403);
	}
	if (!detail.match.teamA || !detail.match.teamB) {
		throw new TournamentError('Both teams must be known before uploading a replay.', 409);
	}

	const admin = getSupabaseAdminClient();
	if (!admin) throw new TournamentError('Tournament tools require SUPABASE_SERVICE_ROLE_KEY.', 503);
	const { data: existing, error } = await admin
		.from('tournament_match_games')
		.select('id, match_id')
		.eq('replay_guid', parsed.data.replayGuid)
		.maybeSingle<{ id: string; match_id: string }>();
	if (error) {
		if (error.code === '42703') {
			throw new TournamentError('Replay tracking is not available yet.', 503);
		}
		throw new TournamentError('Could not check this replay.', 500);
	}
	if (existing && existing.match_id !== input.matchId) {
		throw new TournamentError('This replay is already recorded on another match.', 409);
	}

	return {
		payload: parsed.data,
		alreadyOnThisMatch: Boolean(existing)
	};
}
