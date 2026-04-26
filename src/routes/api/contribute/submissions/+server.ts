import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createDraftSubmission,
	updateDraftSubmission,
	listSubmissionsForUser
} from '$lib/server/submissions';
import {
	parseJsonBody,
	rethrowAsHttp,
	submissionDraftSchema
} from '$lib/server/submission-requests';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');

	const body = await parseJsonBody(request, submissionDraftSchema);

	try {
		const submission = body.id
			? await updateDraftSubmission(body.id, user.id, body)
			: await createDraftSubmission(user.id, body);
		return json(submission, { status: body.id ? 200 : 201 });
	} catch (err) {
		rethrowAsHttp(err);
	}
};

export const GET: RequestHandler = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');

	const submissions = await listSubmissionsForUser(user.id);
	return json(submissions);
};
