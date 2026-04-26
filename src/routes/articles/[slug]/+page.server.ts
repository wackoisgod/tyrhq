import { error } from '@sveltejs/kit';
import { loadAllNewsPosts } from '$lib/server/content';
import type { PageServerLoad } from './$types';

const articleMeta = import.meta.glob('/src/content/news/*.md', {
	eager: true,
	import: 'metadata'
});

export const load: PageServerLoad = ({ params }) => {
	const posts = loadAllNewsPosts(articleMeta as Parameters<typeof loadAllNewsPosts>[0]);
	const post = posts.find((p) => p.slug === params.slug);

	if (!post) throw error(404, 'Post not found');

	return { post };
};
