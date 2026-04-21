import { error } from '@sveltejs/kit';
import { loadAllNewsPosts } from '$lib/server/content';
import type { PageServerLoad } from './$types';

const articleModules = import.meta.glob('/src/content/news/*.md', {
	query: '?raw',
	eager: true,
	import: 'default'
});

export const load: PageServerLoad = ({ params }) => {
	const posts = loadAllNewsPosts(articleModules as Record<string, string>);
	const post = posts.find((p) => p.slug === params.slug);

	if (!post) throw error(404, 'Post not found');

	return { post };
};
