// Curated community links surfaced on the /community page. Adding a Discord,
// fan site, or tool is a data-only change here — no route or component edits
// needed. Groups render in array order; a group with no links is skipped.

export type CommunityLink = {
	label: string;
	href: string;
	/** One-line description shown under the link label. */
	description?: string;
	/** Short badge rendered next to the label, e.g. "Discord", "Tool", "Wiki". */
	tag?: string;
};

export type CommunityGroup = {
	heading: string;
	/** Small monospace annotation shown beside the group heading. */
	annotation?: string;
	links: CommunityLink[];
};

export const communityGroups: CommunityGroup[] = [
	{
		heading: 'Official Channels',
		annotation: 'STOKE GAMES',
		links: [
			{
				label: 'Tyr Discord',
				href: 'https://discord.com/invite/tyr',
				description: 'The official Tyr Discord — announcements, LFG, and direct dev contact.',
				tag: 'Discord'
			},
			{
				label: 'Steam Community Hub',
				href: 'https://steamcommunity.com/app/2445260',
				description: 'Discussions, screenshots, and community content on Steam.',
				tag: 'Steam'
			}
		]
	},
	{
		heading: 'Community Discords',
		annotation: 'PLAYER-RUN',
		links: [
			{
				label: 'The Tyr Hotline',
				href: 'https://discord.gg/7WxrVHq8W',
				description: 'Community-run hub for Tyr players.',
				tag: 'Discord'
			}
		]
	},
	{
		heading: 'Sites & Tools',
		annotation: 'FAN-MADE',
		links: [
			// Add community sites, wikis, and tools here, e.g.:
			// {
			// 	label: 'Tyr Wiki',
			// 	href: 'https://…',
			// 	description: 'Community-maintained wiki.',
			// 	tag: 'Wiki'
			// }
		]
	}
];
