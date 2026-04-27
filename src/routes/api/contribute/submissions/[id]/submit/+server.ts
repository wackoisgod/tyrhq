import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { submitForReview } from '$lib/server/submissions';
import { rethrowAsHttp } from '$lib/server/submission-requests';

export const POST: RequestHandler = async ({ params, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');

	const accountCreatedAt = user.created_at ?? new Date().toISOString();

	try {
		const submission = await submitForReview(params.id!, user.id, accountCreatedAt, role);
		return json(submission);
	} catch (err) {
		rethrowAsHttp(err);
	}
};
