import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		throw redirect(303, `/auth?next=${encodeURIComponent(url.pathname + url.search)}`);
	}

	// 'patch' is deliberately absent: patch notes are mirrored from the official
	// site by the sync service, not uploaded (see patch-notes-sync.ts).
	const requestedType = url.searchParams.get('type');
	const type: 'guide' | 'article' = requestedType === 'article' ? 'article' : 'guide';
	return { type };
};
