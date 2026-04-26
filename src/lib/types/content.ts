export type HeroFrontmatter = {
	headline: string;
	tagline: string;
	ctas: Array<{
		label: string;
		href: string;
		style: 'primary' | 'outline';
		external?: boolean;
	}>;
};

export type FeaturedFrontmatter = {
	tankIds: string[];
	componentIds: string[];
};

export type PanelFrontmatter = {
	title: string;
	order?: number;
	style?: 'links' | 'builds' | 'steam-news' | 'default';
	builds?: Array<{
		slug: string;
		label: string;
		vehicleId: string;
	}>;
	steamFeedUrl?: string;
	maxItems?: number;
};

export type SteamNewsItem = {
	title: string;
	link: string;
	date: string;
	summary: string;
};

export type YouTubeVideo = {
	title: string;
	videoId: string;
	thumbnail: string;
	date: string;
};

export type NewsFrontmatter = {
	title: string;
	date?: string;
	author?: string;
	summary?: string;
	tags?: string[];
	draft?: boolean;
};
