import type { PageServerLoad } from './$types';
import type { RawBuildRow } from '$lib/utils/build-card';

const PAGE_SIZE = 24;

export const load: PageServerLoad = async ({ locals, url }) => {
	const pageParam = parseInt(url.searchParams.get('page') ?? '1', 10);
	const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

	let builds: RawBuildRow[] = [];
	let totalCount = 0;

	if (locals.supabase) {
		const start = (page - 1) * PAGE_SIZE;
		const end = start + PAGE_SIZE - 1;

		const { data, count } = await locals.supabase
			.from('builds')
			.select(
				'slug, title, vehicle_id, star_count, updated_at, selection, profiles(display_name)',
				{ count: 'exact' }
			)
			.eq('is_public', true)
			.order('updated_at', { ascending: false })
			.range(start, end);

		builds = data ?? [];
		totalCount = count ?? 0;
	}

	const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

	return {
		builds,
		page,
		pageSize: PAGE_SIZE,
		totalCount,
		totalPages
	};
};
