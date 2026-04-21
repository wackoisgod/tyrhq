import matter from 'gray-matter';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export type ContentFile<T extends Record<string, unknown> = Record<string, unknown>> = {
	frontmatter: T;
	html: string;
	raw: string;
};

const markdownSanitizeOptions: sanitizeHtml.IOptions = {
	allowedTags: [
		'a',
		'blockquote',
		'br',
		'code',
		'del',
		'em',
		'h1',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6',
		'hr',
		'img',
		'li',
		'ol',
		'p',
		'pre',
		'strong',
		'table',
		'tbody',
		'td',
		'th',
		'thead',
		'tr',
		'ul'
	],
	allowedAttributes: {
		a: ['href', 'title'],
		img: ['src', 'alt', 'title', 'width', 'height', 'loading']
	},
	allowedSchemes: ['http', 'https', 'mailto'],
	enforceHtmlBoundary: true
};

export function sanitizeRenderedMarkdown(html: string) {
	return sanitizeHtml(html, markdownSanitizeOptions);
}

export function parseContent<T extends Record<string, unknown>>(rawFile: string): ContentFile<T> {
	const { data, content } = matter(rawFile);
	const html = sanitizeRenderedMarkdown(marked.parse(content, { async: false }) as string);
	return {
		frontmatter: data as T,
		html,
		raw: content
	};
}

export type NewsPost = {
	slug: string;
	title: string;
	date: string;
	author?: string;
	summary?: string;
	tags?: string[];
	html: string;
	draft?: boolean;
};

export function parseNewsPost(filename: string, rawFile: string): NewsPost {
	const { frontmatter, html } = parseContent<{
		title: string;
		date?: string;
		author?: string;
		summary?: string;
		tags?: string[];
		draft?: boolean;
	}>(rawFile);

	const basename = filename.split('/').pop()!.replace(/\.md$/, '');
	const slug = basename.replace(/^\d{4}-\d{2}-\d{2}-/, '');
	const dateFromFilename = basename.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? '';

	return {
		slug,
		title: frontmatter.title,
		date: frontmatter.date ?? dateFromFilename,
		author: frontmatter.author,
		summary: frontmatter.summary,
		tags: frontmatter.tags,
		draft: frontmatter.draft,
		html
	};
}

export function loadAllNewsPosts(modules: Record<string, string>): NewsPost[] {
	return Object.entries(modules)
		.map(([path, raw]) => parseNewsPost(path, raw))
		.sort((a, b) => b.date.localeCompare(a.date));
}

import { XMLParser } from 'fast-xml-parser';
import type { SteamNewsItem, YouTubeVideo } from '$lib/types/content';

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
			const plainText = item.contents
				.replace(/\s+/g, ' ')
				.trim();
			const summary = plainText.length > 200 ? plainText.slice(0, 200).replace(/\s\S*$/, '…') : plainText;

			return {
				title: item.title,
				link: item.url,
				date: new Date(item.date * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
				summary
			};
		});
	} catch (e) {
		console.error('Failed to fetch Steam news:', e);
		return [];
	}
}

export async function fetchYouTubePlaylist(playlistId: string, maxItems: number = 3): Promise<YouTubeVideo[]> {
	try {
		const res = await fetch(
			`https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`,
			{ signal: AbortSignal.timeout(5000) }
		);
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
					? new Date(String(entry.published)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
					: ''
			};
		});
	} catch (e) {
		console.error('Failed to fetch YouTube playlist:', e);
		return [];
	}
}
