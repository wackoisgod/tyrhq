import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		throw redirect(303, `/auth?next=${encodeURIComponent(url.pathname + url.search)}`);
	}

	const requestedType = url.searchParams.get('type');
	const type: 'guide' | 'article' | 'patch' =
		requestedType === 'article'
			? 'article'
			: requestedType === 'patch'
				? 'patch'
				: 'guide';
	return { type };
};
