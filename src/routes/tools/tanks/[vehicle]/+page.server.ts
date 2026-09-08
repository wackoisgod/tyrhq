import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getGameDataBundle, getGameSnapshot } from '$lib/data/game-data';
import { hasVehicleArmorAssets } from '$lib/server/game-assets';
import { listPublishedArticles } from '$lib/server/articles';

/**
 * Everything this load returns is the same for every visitor, so the
 * response is CDN-cacheable. The per-user notepad is fetched client-side
 * from /api/tank-notes instead. Authenticated responses are still forced
 * to `private, no-store` by the server hook, so only anonymous traffic is
 * served from the cache.
 */
export const load: PageServerLoad = async ({ params, locals, setHeaders }) => {
	setHeaders({
		'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600'
	});

	const snapshot = getGameSnapshot();
	const bundle = getGameDataBundle();
	const slugOrId = params.vehicle;

	const tank = snapshot.tanks.find((entry) => entry.slug === slugOrId || entry.id === slugOrId);
	const vehicle = bundle.vehicles.find(
		(entry) => entry.slug === slugOrId || entry.id === slugOrId
	);

	if (!tank || !vehicle) {
		throw error(404, 'Vehicle not found');
	}

	const componentById = new Map(bundle.components.map((c) => [c.id, c]));
	const nativeComponents = vehicle.nativeComponents.map((nc) => {
		const comp = componentById.get(nc.componentId);
		return {
			id: nc.componentId,
			slug: comp?.slug ?? nc.componentId,
			level: nc.level,
			name: comp?.name ?? nc.componentId,
			description: comp?.description ?? '',
			category: comp?.category ?? ''
		};
	});

	// Public builds for this vehicle (same for every visitor)
	let publicBuilds: Array<{
		id: string;
		slug: string;
		title: string;
		updated_at: string;
		star_count: number;
		selection: { componentIds?: string[]; ammoIds?: string[] } | null;
		profiles: { display_name: string } | { display_name: string }[] | null;
	}> = [];

	if (locals.supabase) {
		const { data: pubData } = await locals.supabase
			.from('builds')
			.select('id, slug, title, updated_at, star_count, selection, profiles(display_name)')
			.eq('vehicle_id', vehicle.id)
			.eq('is_public', true)
			.order('star_count', { ascending: false })
			.order('updated_at', { ascending: false })
			.limit(20);

		publicBuilds = pubData ?? [];
	}

	const componentNames = Object.fromEntries(bundle.components.map((c) => [c.id, c.name]));
	const ammoNames = Object.fromEntries(
		bundle.ammo
			.filter((ammo) => ammo.id === 'standard' || ammo.selectable)
			.map((ammo) => [ammo.id, ammo.displayName])
	);

	const relatedGuides = (await listPublishedArticles('guide'))
		.filter((g) => g.vehicleSlugs?.includes(tank.slug))
		.map((g) => ({
			slug: g.slug,
			title: g.title,
			date: g.publishedAt.slice(0, 10),
			summary: g.summary,
			tags: g.tags,
			author: g.authorDisplay,
			starCount: g.starCount,
			isNew: g.isNew
		}));

	return {
		tank,
		nativeComponents,
		armorAvailable: hasVehicleArmorAssets(vehicle.id),
		publicBuilds,
		componentNames,
		ammoNames,
		relatedGuides
	};
};
