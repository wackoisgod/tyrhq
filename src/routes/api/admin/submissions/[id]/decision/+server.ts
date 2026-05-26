import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { decideSubmission } from '$lib/server/submissions';
import {
	decisionBodySchema,
	parseJsonBody,
	rethrowAsHttp
} from '$lib/server/submission-requests';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');
	if (role !== 'contributor' && role !== 'admin') {
		error(403, 'Reviewer role required');
	}

	const body = await parseJsonBody(request, decisionBodySchema);

	try {
		const submission = await decideSubmission(
			params.id!,
			{ id: user.id, role },
			{
				decision: body.decision,
				notes: body.notes ?? null,
				flyoutSection: body.flyoutSection,
				flyoutOrder: body.flyoutOrder,
				expectedContentHash: body.expectedContentHash ?? null,
				reviewerBodyMarkdown: body.reviewerBodyMarkdown ?? null
			}
		);
		return json(submission);
	} catch (err) {
		rethrowAsHttp(err);
	}
};
