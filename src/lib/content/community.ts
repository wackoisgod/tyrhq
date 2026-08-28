// Fallback community links for the /community page.
//
// The live directory is admin-curated in the database (community_link_groups /
// community_links, edited at /admin/community-links). These groups are only
// served when Supabase isn't configured — local dev without a service-role
// key, or a preview build — so the page never renders empty. They also seed a
// fresh database via migration 018. Editing this file does NOT change a
// deployed site; use the admin page for that.
//
// Groups render in array order; a group with no links is skipped.

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
				href: 'https://discord.gg/kbJG4xrAM',
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
