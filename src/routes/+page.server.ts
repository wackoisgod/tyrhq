import { getGameSnapshot } from '$lib/data/game-data';
import { fetchYouTubePlaylist } from '$lib/server/content';
import { listPublishedArticles } from '$lib/server/articles';
import { communityBulletins } from '$lib/content/bulletins';
import { isRecentlyPublished } from '$lib/utils/article-recency';
import { compareVersionsDesc } from '$lib/utils/version';
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


	// Pre-slice each type so the home's All/Articles/Guides/Patches filter chips
	// can switch instantly without a server round-trip and each chip always
	// shows that type's newest items.
	const [articles, guides, patches] = await Promise.all([
		listPublishedArticles('article'),
		listPublishedArticles('guide'),
		listPublishedArticles('patch')
	]);
	const PREVIEW_LIMIT = 3;
	// Patches sort by version desc (back-publishing v0.4.1 today shouldn't
	// outrank v0.5.x); other types stay chronological. The "all" merge mixes
	// only articles + guides — patches stay categorically separate and are
	// only surfaced under their own chip.
	const patchesByVersion = [...patches].sort((a, b) => {
		const cmp = compareVersionsDesc(a.version, b.version);
		if (cmp !== 0) return cmp;
		return b.publishedAt.localeCompare(a.publishedAt);
	});
	// Bulletins are hand-authored external links (see $lib/content/bulletins)
	// reshaped to match the article summary fields the dispatch card reads.
	// `type: 'bulletin'` + `href` is what makes the card link out.
	const bulletins = communityBulletins.map((bulletin, index) => ({
		id: `bulletin-${index}`,
		type: 'bulletin' as const,
		href: bulletin.href,
		title: bulletin.title,
		summary: bulletin.byline,
		tags: bulletin.tags ?? [],
		publishedAt: bulletin.publishedAt,
		isNew: isRecentlyPublished(bulletin.publishedAt),
		heroImageUrl: null,
		version: null,
		label: bulletin.label ?? 'Community'
	}));
	const latestDispatches = {
		all: [...articles, ...guides, ...bulletins]
			.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
			.slice(0, PREVIEW_LIMIT),
		article: articles.slice(0, PREVIEW_LIMIT),
		guide: guides.slice(0, PREVIEW_LIMIT),
		patch: patchesByVersion.slice(0, PREVIEW_LIMIT)
	};

	return {
		snapshot,
		hero: {
			headline: hero.headline,
			tagline: hero.tagline,
			ctas: hero.ctas
		},
		devVideos,
		latestBuilds,
		latestDispatches
	};
};
