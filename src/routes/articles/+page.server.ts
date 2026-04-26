import { loadAllNewsPosts } from '$lib/server/content';

const articleMeta = import.meta.glob('/src/content/news/*.md', {
	eager: true,
	import: 'metadata'
});

export function load() {
	const posts = loadAllNewsPosts(articleMeta as Parameters<typeof loadAllNewsPosts>[0]).filter(
		(p) => !p.draft
	);

	return { posts };
}
