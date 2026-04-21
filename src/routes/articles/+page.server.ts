import { loadAllNewsPosts } from '$lib/server/content';

const articleModules = import.meta.glob('/src/content/news/*.md', {
	query: '?raw',
	eager: true,
	import: 'default'
});

export function load() {
	const posts = loadAllNewsPosts(articleModules as Record<string, string>).filter((p) => !p.draft);

	return { posts };
}
