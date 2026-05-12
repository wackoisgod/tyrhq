import { error, redirect } from '@sveltejs/kit';

import { getGameSnapshot } from '$lib/data/game-data';
import { getMapBySlug, getMaps } from '$lib/data/maps';
import { getMapRoomWithEffectiveState } from '$lib/server/map-rooms';
import { parseRoomToken } from '$lib/server/map-room-requests';

export async function load({ params, locals }) {
	const token = parseRoomToken(params.token);
	const roomResult = await getMapRoomWithEffectiveState(token);
	if (!roomResult) throw error(404, 'Room not found');

	if (roomResult.room.map_slug !== params.slug) {
		redirect(307, `/maps/${roomResult.room.map_slug}/room/${roomResult.room.share_token}`);
	}

	const map = getMapBySlug(roomResult.room.map_slug);
	if (!map) throw error(404, 'Map not found');

	const allMaps = getMaps();
	const otherMaps = allMaps.filter((entry) => entry.slug !== map.slug).slice(0, 4);
	const availableMaps = allMaps.map((entry) => ({
		slug: entry.slug,
		name: entry.name
	}));

	const tanks = getGameSnapshot()
		.tanks.filter((tank) => tank.selectable)
		.map((tank) => ({
			id: tank.id,
			name: tank.name,
			classId: tank.classId,
			vision: tank.stats.vision
		}));

	const { user } = await locals.safeGetSession();

	return {
		map,
		otherMaps,
		availableMaps,
		tanks,
		room: {
			token: roomResult.room.share_token,
			title: roomResult.room.title,
			initialState: roomResult.state,
			isHost: user?.id === roomResult.room.host_user_id
		}
	};
}
