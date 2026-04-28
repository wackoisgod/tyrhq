import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getGameDataBundle, getGameSnapshot } from '$lib/data/game-data';
import { hasVehicleArmorAssets } from '$lib/server/game-assets';
import { listPublishedArticles } from '$lib/server/articles';

export const load: PageServerLoad = async ({ params, locals }) => {
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

	// Fetch builds for this vehicle
	let userBuildCount = 0;
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
		const { user } = await locals.safeGetSession();

		// Count user's builds for this vehicle (for summary card)
		if (user) {
			const { count } = await locals.supabase
				.from('builds')
				.select('id', { count: 'exact', head: true })
				.eq('user_id', user.id)
				.eq('vehicle_id', vehicle.id);
			userBuildCount = count ?? 0;
		}

		// Fetch all public builds for this vehicle
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
			starCount: g.starCount
		}));

	return {
		tank,
		nativeComponents,
		armorAvailable: hasVehicleArmorAssets(vehicle.id),
		userBuildCount,
		publicBuilds,
		componentNames,
		ammoNames,
		relatedGuides
	};
};
