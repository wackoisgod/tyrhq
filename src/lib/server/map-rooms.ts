import { randomInt } from 'node:crypto';

import { buildCompactState, parseCompactState, applyPlannerOperation, type CompactState, type PlannerOperationEnvelope } from '$lib/maps/planner';
import { getSupabaseAdminClient } from '$lib/server/supabase-admin';

const MAX_ROOM_EVENTS = 2_000;

export class MapRoomEventLimitError extends Error {
	constructor() {
		super('Map room event limit reached');
		this.name = 'MapRoomEventLimitError';
	}
}

export type MapRoomRecord = {
	id: string;
	map_slug: string;
	host_user_id: string;
	title: string;
	share_token: string;
	state: CompactState | null;
	created_at: string;
	updated_at: string;
	last_activity_at: string;
};

type MapRoomEventRecord = {
	id: number;
	room_id: string;
	event_id: string;
	actor_id: string;
	actor_name: string;
	op_type: string;
	payload: unknown;
	client_ts: string | null;
	created_at: string;
};

function getAdminClientOrThrow() {
	const admin = getSupabaseAdminClient();
	if (!admin) {
		throw new Error('Supabase admin client is not configured');
	}

	return admin;
}

function createToken(length = 20) {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
	let token = '';
	for (let index = 0; index < length; index += 1) {
		token += chars[randomInt(chars.length)];
	}
	return token;
}

export function buildRoomUrl(mapSlug: string, shareToken: string) {
	return `/maps/${mapSlug}/room/${shareToken}`;
}

export async function createMapRoom(input: {
	mapSlug: string;
	hostUserId: string;
	title: string;
	state: CompactState;
}) {
	const admin = getAdminClientOrThrow();

	const insertRow = {
		map_slug: input.mapSlug,
		host_user_id: input.hostUserId,
		title: input.title,
		state: input.state,
		share_token: createToken()
	};

	const { data, error } = await admin
		.from('map_rooms')
		.insert(insertRow)
		.select('id, map_slug, host_user_id, title, share_token, state, created_at, updated_at, last_activity_at')
		.single<MapRoomRecord>();

	if (error) throw error;
	return data;
}

export async function getMapRoomByToken(shareToken: string) {
	const admin = getAdminClientOrThrow();
	const { data, error } = await admin
		.from('map_rooms')
		.select('id, map_slug, host_user_id, title, share_token, state, created_at, updated_at, last_activity_at')
		.eq('share_token', shareToken)
		.maybeSingle<MapRoomRecord>();

	if (error) throw error;
	return data;
}

export async function getMapRoomWithEffectiveState(shareToken: string) {
	const admin = getAdminClientOrThrow();
	const room = await getMapRoomByToken(shareToken);
	if (!room) return null;

	const { data: events, error } = await admin
		.from('map_room_events')
		.select('id, room_id, event_id, actor_id, actor_name, op_type, payload, client_ts, created_at')
		.eq('room_id', room.id)
		.order('id', { ascending: true })
		.returns<MapRoomEventRecord[]>();

	if (error) throw error;

	let plannerState = parseCompactState((room.state ?? {}) as CompactState);
	for (const entry of events ?? []) {
		if (!entry.payload || typeof entry.payload !== 'object') continue;
		const payload = entry.payload as { type?: string };
		if (payload.type !== entry.op_type) continue;
		plannerState = applyPlannerOperation(plannerState, entry.payload as PlannerOperationEnvelope['operation']);
	}

	return {
		room,
		state: buildCompactState(plannerState),
		eventCount: events?.length ?? 0
	};
}

export async function appendMapRoomEvent(shareToken: string, envelope: PlannerOperationEnvelope) {
	const admin = getAdminClientOrThrow();
	const room = await getMapRoomByToken(shareToken);
	if (!room) return { room: null, duplicate: false };

	const { count, error: countError } = await admin
		.from('map_room_events')
		.select('id', { count: 'exact', head: true })
		.eq('room_id', room.id);

	if (countError) throw countError;
	if ((count ?? 0) >= MAX_ROOM_EVENTS) {
		throw new MapRoomEventLimitError();
	}

	const { error } = await admin.from('map_room_events').insert({
		room_id: room.id,
		event_id: envelope.eventId,
		actor_id: envelope.actorId,
		actor_name: envelope.actorName,
		op_type: envelope.operation.type,
		payload: envelope.operation,
		client_ts: envelope.clientTs
	});

	if (error) {
		if ((error as { code?: string }).code === '23505') {
			return { room, duplicate: true };
		}
		throw error;
	}

	const now = new Date().toISOString();
	const { error: updateError } = await admin
		.from('map_rooms')
		.update({ updated_at: now, last_activity_at: now })
		.eq('id', room.id);

	if (updateError) throw updateError;

	return { room, duplicate: false };
}
