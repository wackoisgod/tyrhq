import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { updateArticleFlyoutAssignment } from '$lib/server/articles';
import {
	flyoutAssignmentBodySchema,
	parseJsonBody,
	rethrowAsHttp
} from '$lib/server/submission-requests';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');
	if (role !== 'contributor' && role !== 'admin') error(403, 'Reviewer role required');

	const body = await parseJsonBody(request, flyoutAssignmentBodySchema);

	try {
		await updateArticleFlyoutAssignment(params.id!, {
			flyoutSection: body.flyoutSection ?? null,
			flyoutOrder: body.flyoutOrder ?? null,
			isPinned: body.isPinned
		});
		return json({ ok: true });
	} catch (err) {
		rethrowAsHttp(err);
	}
};
