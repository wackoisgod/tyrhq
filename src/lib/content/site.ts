import { env } from '$env/dynamic/public';

const repoUrl = env.PUBLIC_REPO_URL?.trim() ?? '';

export type NavLeaf = { href: string; label: string };
export type NavGroup = {
	label: string;
	columns: { heading: string; items: NavLeaf[] }[];
};
export type NavItem = NavLeaf | NavGroup;

export const navigation: NavItem[] = [
	{ href: '/', label: 'Home' },
	{ href: '/game', label: 'Game' },
	{ href: '/articles', label: 'Articles' },
	{ href: '/guides', label: 'Guides' },
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
			{ heading: 'World', items: [{ href: '/maps', label: 'Maps' }] }
		]
	}
];

export const footerSections = [
	{
		title: 'Community',
		links: [
			{ href: '/auth', label: 'Accounts' },
			{ href: '/builds', label: 'My Builds' },
			{ href: '/contribute', label: 'Contribute' },
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
