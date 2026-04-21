import { getGameSnapshot } from '$lib/data/game-data';
import { parseContent, fetchSteamNews, fetchYouTubePlaylist } from '$lib/server/content';
import type { HeroFrontmatter } from '$lib/types/content';

const heroModules = import.meta.glob('/src/content/home/hero.md', {
	query: '?raw',
	eager: true,
	import: 'default'
});

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const snapshot = getGameSnapshot();

	// Hero
	const heroRaw = Object.values(heroModules)[0] as string;
	const hero = parseContent<HeroFrontmatter>(heroRaw);

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

	return {
		snapshot,
		hero: {
			headline: hero.frontmatter.headline,
			tagline: hero.frontmatter.tagline,
			ctas: hero.frontmatter.ctas,
			bodyHtml: hero.html
		},
		latestSteamPost,
		devVideos,
		latestBuilds
	};
};
