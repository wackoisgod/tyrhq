// Community bulletins: hand-authored dispatches that surface in the home
// page's "Latest Dispatches" feed but link OUT to an external destination
// (a Discord, a community site, a tournament page) instead of an on-site
// article. Adding one is a data-only change here.
//
// `publishedAt` (YYYY-MM-DD) controls where the bulletin sorts in the feed
// and drives the "New" pill for the first 7 days. The feed shows the newest
// few items, so an old bulletin naturally rotates out.

export type CommunityBulletin = {
	title: string;
	/** One-line byline shown under the title. */
	byline: string;
	/** External URL the card links to (opens in a new tab). */
	href: string;
	/** ISO date (YYYY-MM-DD) used for feed ordering and the "New" pill. */
	publishedAt: string;
	/** Badge text on the card. Defaults to "Community". */
	label?: string;
	/** Optional extra tag chips (the card shows at most two). */
	tags?: string[];
};

export const communityBulletins: CommunityBulletin[] = [
	{
		title: 'The Tyr Hotline is live',
		byline: 'A community-run Discord for Tyr players — drop in and say hello.',
		href: 'https://discord.gg/kbJG4xrAM',
		publishedAt: '2026-07-20',
		label: 'Community',
		tags: ['Discord']
	}
];
