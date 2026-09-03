import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { runPatchNoteSync } from '$lib/server/patch-notes-runner';
import { parseJsonBody } from '$lib/server/submission-requests';
import type { RequestHandler } from './$types';

const syncBodySchema = z
	.object({
		/** Walk the whole official archive instead of just the newest page. */
		full: z.boolean().optional(),
		/** Re-render every note even when its upstream hash is unchanged. */
		force: z.boolean().optional()
	})
	.strict();

/**
 * Manual patch note sync, for the button on /admin/articles. The scheduled run
 * (see /api/cron/patch-notes) covers the normal case; this exists to backfill
 * the archive and to re-pull after upstream fixes a typo.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');
	if (role !== 'contributor' && role !== 'admin') error(403, 'Reviewer role required');

	const body = request.headers.get('content-length')
		? await parseJsonBody(request, syncBodySchema)
		: {};

	const result = await runPatchNoteSync(body);
	if (!result.ok) {
		// 502 when the official site is the problem, 500 when we are.
		error(result.kind === 'upstream' ? 502 : 500, result.error);
	}

	return json({ ok: true, report: result.report });
};
