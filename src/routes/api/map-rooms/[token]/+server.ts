import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { getMapRoomWithEffectiveState } from '$lib/server/map-rooms';
import { parseRoomToken } from '$lib/server/map-room-requests';

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
