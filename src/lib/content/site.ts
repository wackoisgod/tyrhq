import { env } from '$env/dynamic/public';
import { FLYOUT_SECTION_ORDER, type FlyoutSection } from './flyout-sections';

const repoUrl = env.PUBLIC_REPO_URL?.trim() ?? '';

export type NavLeaf = { href: string; label: string };
export type NavGroup = {
	label: string;
	columns: { heading: string; items: NavLeaf[] }[];
};
export type NavItem = NavLeaf | NavGroup;

export type FlyoutNavEntry = {
	section: FlyoutSection;
	href: string;
	label: string;
	order: number | null;
};

export const navigation: NavItem[] = [
	{ href: '/', label: 'Home' },
	{ href: '/game', label: 'Game' },
	{ href: '/articles', label: 'Articles' },
	{ href: '/guides', label: 'Guides' },
	{ href: '/tournaments', label: 'Tournaments' },
	{ href: '/tools/tanks', label: 'Tanks' },
	{
		label: 'Resources',
		columns: [
			{
				heading: 'Database',
				items: [
					{ href: '/tools/components', label: 'Components' },
					{ href: '/tools/shells', label: 'Shells' }
				]
			},
			{ heading: 'World', items: [{ href: '/maps', label: 'Maps' }] },
			{ heading: 'Updates', items: [{ href: '/patch-notes', label: 'Patch Notes' }] }
		]
	}
];

/**
 * Build a navigation array that merges admin-curated flyout entries into the
 * static `Resources` mega-menu. Sections that match an existing column heading
 * (e.g. "Database", "World") get appended into that column; new sections
 * become new columns ordered by FLYOUT_SECTION_ORDER.
 */
export function buildNavigation(entries: FlyoutNavEntry[]): NavItem[] {
	if (entries.length === 0) return navigation;

	const grouped = new Map<FlyoutSection, NavLeaf[]>();
	for (const entry of [...entries].sort((a, b) => {
		const oa = a.order ?? Number.MAX_SAFE_INTEGER;
		const ob = b.order ?? Number.MAX_SAFE_INTEGER;
		if (oa !== ob) return oa - ob;
		return a.label.localeCompare(b.label);
	})) {
		const existing = grouped.get(entry.section);
		const leaf: NavLeaf = { href: entry.href, label: entry.label };
		if (existing) existing.push(leaf);
		else grouped.set(entry.section, [leaf]);
	}

	return navigation.map((item) => {
		if (!('columns' in item) || item.label !== 'Resources') return item;
		const mergedColumns = item.columns.map((col) => {
			const additions = grouped.get(col.heading as FlyoutSection);
			if (!additions) return col;
			grouped.delete(col.heading as FlyoutSection);
			return { heading: col.heading, items: [...col.items, ...additions] };
		});
		// Append remaining sections as new columns, ordered by the enum.
		for (const section of FLYOUT_SECTION_ORDER) {
			const items = grouped.get(section);
			if (items) {
				mergedColumns.push({ heading: section, items });
				grouped.delete(section);
			}
		}
		// Defensive: any section not in FLYOUT_SECTION_ORDER (shouldn't happen
		// since the enum gates inserts) trails alphabetically.
		for (const [section, items] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
			mergedColumns.push({ heading: section, items });
		}
		return { ...item, columns: mergedColumns };
	});
}

export const footerSections = [
	{
		title: 'Community',
		links: [
			{ href: '/auth', label: 'Accounts' },
			{ href: '/builds', label: 'My Builds' },
			{ href: '/teams', label: 'Teams' },
			{ href: '/tournaments', label: 'Tournaments' },
			{ href: '/contribute', label: 'Contribute' },
			{ href: '/patch-notes', label: 'Patch Notes' },
			{ href: '/settings', label: 'Settings' }
		]
	},
	{
		title: 'Official Links',
		links: [
			{
				href: 'https://stoke.firstlook.gg/?utm_source=playtyr&utm_content=playtyr-home',
				label: 'Playtest'
			},
			{
				href: 'https://store.steampowered.com/app/2445260/Tyr/?utm_source=playtyr&utm_content=playtyr-home',
				label: 'Wishlist'
			},
			{ href: 'https://store.steampowered.com/news/app/2445260', label: 'News Hub' }
		]
	},
	{
		title: 'Social',
		links: [
			{ href: 'https://discord.com/invite/tyr', label: 'Discord' },
			...(repoUrl ? [{ href: repoUrl, label: 'GitHub' }] : [])
		]
	}
];

export const siteCopy = {
	title: 'Tyr HQ',
	tagline: 'Theory craft your builds, learn the maps, get better at Tyr.',
	description:
		'Tyr HQ is an independent third-party companion for Tyr: study every tank, pressure-test your builds, and track official Stoke Games updates in one place.',
	statusDisclaimer:
		'Tyr HQ is an independent third-party site and is open source under the MIT License.',
	legalDisclaimer:
		'Tyr HQ is a third-party site and is not affiliated with, endorsed by, or operated by Stoke Games.',
	rightsDisclaimer:
		'Tyr and all related names, logos, game assets, and references remain the property of Stoke Games.',
	playtestUrl: 'https://stoke.firstlook.gg/?utm_source=playtyr&utm_content=playtyr-home',
	wishlistUrl: 'https://store.steampowered.com/app/2445260/Tyr/?utm_source=playtyr&utm_content=playtyr-home',
	newsUrl: 'https://store.steampowered.com/news/app/2445260',
	discordUrl: 'https://discord.com/invite/tyr',
	repoUrl
};
