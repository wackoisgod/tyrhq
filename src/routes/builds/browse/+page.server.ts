import type { PageServerLoad } from './$types';
import type { RawBuildRow } from '$lib/utils/build-card';
import { getGameDataBundle } from '$lib/data/game-data';

const PAGE_SIZE = 24;

export type BuildSort = 'top' | 'new';

export const load: PageServerLoad = async ({ locals, url }) => {
	const pageParam = parseInt(url.searchParams.get('page') ?? '1', 10);
	const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

	const sort: BuildSort = url.searchParams.get('sort') === 'top' ? 'top' : 'new';

	const vehicleParam = url.searchParams.get('vehicle')?.trim() ?? '';
	const vehicle = vehicleParam
		? getGameDataBundle().vehicles.find(
				(v) => v.slug === vehicleParam || v.id === vehicleParam
			) ?? null
		: null;

	let builds: RawBuildRow[] = [];
	let totalCount = 0;

	if (locals.supabase) {
		const start = (page - 1) * PAGE_SIZE;
		const end = start + PAGE_SIZE - 1;

		let query = locals.supabase
			.from('builds')
			.select(
				'slug, title, vehicle_id, star_count, updated_at, selection, profiles(display_name)',
				{ count: 'exact' }
			)
			.eq('is_public', true);

		if (vehicle) {
			query = query.eq('vehicle_id', vehicle.id);
		}

		if (sort === 'top') {
			query = query
				.order('star_count', { ascending: false })
				.order('updated_at', { ascending: false });
		} else {
			query = query.order('updated_at', { ascending: false });
		}

		const { data, count } = await query.range(start, end);

		builds = data ?? [];
		totalCount = count ?? 0;
	}

	const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

	return {
		builds,
		page,
		pageSize: PAGE_SIZE,
		totalCount,
		totalPages,
		sort,
		vehicleFilter: vehicle ? { id: vehicle.id, slug: vehicle.slug, name: vehicle.name } : null,
		vehicleParam: vehicleParam || null,
		vehicleNotFound: vehicleParam !== '' && !vehicle
	};
};
