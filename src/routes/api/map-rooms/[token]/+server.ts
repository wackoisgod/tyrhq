import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { getMapBySlug } from '$lib/data/maps';
import { buildRoomUrl, getMapRoomWithEffectiveState, updateMapRoomMap } from '$lib/server/map-rooms';
import { parseJsonBody, parseRoomToken, updateMapRoomBodySchema } from '$lib/server/map-room-requests';

export const GET: RequestHandler = async ({ params }) => {
	const token = parseRoomToken(params.token);

	try {
		const result = await getMapRoomWithEffectiveState(token);
		if (!result) return error(404, 'Room not found');

		return json({
			room: {
				id: result.room.id,
				mapSlug: result.room.map_slug,
				hostUserId: result.room.host_user_id,
				title: result.room.title,
				shareToken: result.room.share_token,
				createdAt: result.room.created_at,
				updatedAt: result.room.updated_at,
				lastActivityAt: result.room.last_activity_at
			},
			state: result.state
		});
	} catch (cause) {
		console.error('Failed to load map room', cause);
		return error(503, 'Live room lookup is unavailable right now');
	}
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const token = parseRoomToken(params.token);
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return error(401, 'Authentication required');

	const body = await parseJsonBody(request, updateMapRoomBodySchema);
	const map = getMapBySlug(body.mapSlug);
	if (!map) return error(400, 'Unknown map');

	try {
		const result = await updateMapRoomMap({
			shareToken: token,
			hostUserId: user.id,
			mapSlug: body.mapSlug
		});
		if (result.forbidden) return error(403, 'Only the host can change the map for this room');
		if (!result.room) return error(404, 'Room not found');

		return json({
			room: {
				id: result.room.id,
				mapSlug: result.room.map_slug,
				hostUserId: result.room.host_user_id,
				title: result.room.title,
				shareToken: result.room.share_token,
				createdAt: result.room.created_at,
				updatedAt: result.room.updated_at,
				lastActivityAt: result.room.last_activity_at
			},
			roomUrl: buildRoomUrl(result.room.map_slug, result.room.share_token)
		});
	} catch (cause) {
		console.error('Failed to update map room map', cause);
		return error(503, 'Live room update is unavailable right now');
	}
};
