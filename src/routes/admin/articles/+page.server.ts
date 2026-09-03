import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listAllArticlesForAdmin } from '$lib/server/articles';
import { PATCH_NOTES_PATH, resolvePatchNotesOrigin } from '$lib/server/patch-notes-source';

export const load: PageServerLoad = async ({ locals, url }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) {
		throw redirect(303, `/auth?next=${encodeURIComponent(url.pathname)}`);
	}
	if (role !== 'contributor' && role !== 'admin') {
		throw error(403, 'Reviewer role required');
	}

	const articles = await listAllArticlesForAdmin();
	return {
		articles,
		officialPatchNotesUrl: `${resolvePatchNotesOrigin()}${PATCH_NOTES_PATH}`
	};
};
