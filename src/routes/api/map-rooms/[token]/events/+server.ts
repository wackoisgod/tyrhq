import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { appendMapRoomEvent } from '$lib/server/map-rooms';
import { mapRoomEventBodySchema, parseJsonBody, parseRoomToken } from '$lib/server/map-room-requests';

export const POST: RequestHandler = async ({ params, request }) => {
	const token = parseRoomToken(params.token);
	const envelope = await parseJsonBody(request, mapRoomEventBodySchema);

	try {
		const result = await appendMapRoomEvent(token, envelope);
		if (!result.room) return error(404, 'Room not found');

		return json({
			ok: true,
			duplicate: result.duplicate,
			roomId: result.room.id
		});
	} catch (cause) {
		console.error('Failed to append map room event', cause);
		return error(503, 'Live room sync is unavailable right now');
	}
};
