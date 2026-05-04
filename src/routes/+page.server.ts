import { getGameSnapshot } from '$lib/data/game-data';
import { fetchSteamNews, fetchYouTubePlaylist } from '$lib/server/content';
import { listPublishedArticles } from '$lib/server/articles';
import type { HeroFrontmatter } from '$lib/types/content';

const heroMetaMap = import.meta.glob('/src/content/home/hero.md', {
	eager: true,
	import: 'metadata'
});

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const snapshot = getGameSnapshot();

	// Hero
	const heroMeta = Object.values(heroMetaMap)[0] as HeroFrontmatter | undefined;
	const hero = heroMeta ?? { headline: '', tagline: '', ctas: [] };

	// Latest public builds from Supabase
	let latestBuilds: { slug: string; title: string; vehicle_id: string; star_count: number; updated_at: string; selection: { componentIds?: string[]; ammoIds?: string[]; talentPoints?: Record<string, number> } | null; profiles: { display_name: string } | { display_name: string }[] | null }[] = [];
	if (locals.supabase) {
		const { data } = await locals.supabase
			.from('builds')
			.select('slug, title, vehicle_id, star_count, updated_at, selection, profiles(display_name)')
			.eq('is_public', true)
			.order('updated_at', { ascending: false })
			.limit(12);
		latestBuilds = data ?? [];
	}

	// YouTube dev updates
	const devVideos = await fetchYouTubePlaylist('PL7n_PygfF9b_ikfybVVXdNtFzHim1wQLA', 4);

	// Steam news for hero banner
	const steamNews = await fetchSteamNews('2445260', 1);
	const latestSteamPost = steamNews[0] ?? null;

	// Latest articles + guides combined, newest first
	const [articles, guides] = await Promise.all([
		listPublishedArticles('article'),
		listPublishedArticles('guide')
	]);
	const latestDispatches = [...articles, ...guides]
		.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
		.slice(0, 3);

	return {
		snapshot,
		hero: {
			headline: hero.headline,
			tagline: hero.tagline,
			ctas: hero.ctas
		},
		latestSteamPost,
		devVideos,
		latestBuilds,
		latestDispatches
	};
};
