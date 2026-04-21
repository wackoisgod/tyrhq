import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { getMapBySlug } from '$lib/data/maps';
import { buildRoomUrl, createMapRoom } from '$lib/server/map-rooms';
import {
	createMapRoomBodySchema,
	normalizeMapRoomTitle,
	parseJsonBody
} from '$lib/server/map-room-requests';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return error(401, 'Authentication required');

	const body = await parseJsonBody(request, createMapRoomBodySchema);
	const map = getMapBySlug(body.mapSlug);
	if (!map) return error(400, 'Map not found');

	try {
		const room = await createMapRoom({
			mapSlug: body.mapSlug,
			hostUserId: user.id,
			title: normalizeMapRoomTitle(body.title, `${map.name} Live Room`),
			state: body.state ?? {}
		});

		return json(
			{
				room,
				roomUrl: buildRoomUrl(room.map_slug, room.share_token)
			},
			{ status: 201 }
		);
	} catch (cause) {
		console.error('Failed to create map room', cause);
		return error(503, 'Live rooms are not available right now');
	}
};
