import { XMLParser } from 'fast-xml-parser';
import type { SteamNewsItem, YouTubeVideo } from '$lib/types/content';

// Article and guide loaders previously lived here; they were superseded by
// $lib/server/articles.ts when content moved into Supabase. This module now
// only owns external feed fetchers (Steam, YouTube).

export async function fetchSteamNews(appId: string, maxItems: number = 1): Promise<SteamNewsItem[]> {
	try {
		const res = await fetch(
			`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=${maxItems}&maxlength=300`,
			{ signal: AbortSignal.timeout(5000) }
		);
		if (!res.ok) return [];
		const json = await res.json();
		const items = json?.appnews?.newsitems;
		if (!Array.isArray(items)) return [];

		return items.map((item: { title: string; url: string; date: number; contents: string }) => {
			const plainText = item.contents.replace(/\s+/g, ' ').trim();
			const summary =
				plainText.length > 200 ? plainText.slice(0, 200).replace(/\s\S*$/, '…') : plainText;

			return {
				title: item.title,
				link: item.url,
				date: new Date(item.date * 1000).toLocaleDateString('en-US', {
					month: 'short',
					day: 'numeric',
					year: 'numeric'
				}),
				summary
			};
		});
	} catch (e) {
		console.error('Failed to fetch Steam news:', e);
		return [];
	}
}

export async function fetchYouTubePlaylist(
	playlistId: string,
	maxItems: number = 3
): Promise<YouTubeVideo[]> {
	try {
		const res = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`, {
			signal: AbortSignal.timeout(5000)
		});
		if (!res.ok) return [];
		const xml = await res.text();
		const parser = new XMLParser({
			processEntities: false,
			isArray: (name) => name === 'entry'
		});
		const parsed = parser.parse(xml);
		const entries = parsed?.feed?.entry;
		if (!Array.isArray(entries)) return [];

		return entries.slice(0, maxItems).map((entry: Record<string, unknown>) => {
			const videoId = String(entry['yt:videoId'] ?? '');
			const mediaGroup = entry['media:group'] as Record<string, unknown> | undefined;
			const thumbnail = mediaGroup?.['media:thumbnail'] as Record<string, string> | undefined;

			return {
				title: String(mediaGroup?.['media:title'] ?? entry.title ?? ''),
				videoId,
				thumbnail: thumbnail?.url ?? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
				date: entry.published
					? new Date(String(entry.published)).toLocaleDateString('en-US', {
							month: 'short',
							day: 'numeric',
							year: 'numeric'
						})
					: ''
			};
		});
	} catch (e) {
		console.error('Failed to fetch YouTube playlist:', e);
		return [];
	}
}
