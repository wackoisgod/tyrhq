import { getGameSnapshot } from '$lib/data/game-data';
import type { MapSummary } from '$lib/types/game';

export function getMaps(): MapSummary[] {
	return getGameSnapshot().maps.filter((m) => m.status !== 'testmap');
}

export function getMapBySlug(slug: string): MapSummary | undefined {
	return getGameSnapshot().maps.find((m) => m.slug === slug);
}
