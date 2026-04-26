import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSubmissionById } from '$lib/server/submissions';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		throw redirect(303, `/auth?next=${encodeURIComponent(url.pathname)}`);
	}

	const submission = await getSubmissionById(params.id);
	if (!submission) throw error(404, 'Submission not found');
	if (submission.submitter_id !== user.id) {
		throw error(403, 'You can only edit your own submissions');
	}

	return { submission };
};
