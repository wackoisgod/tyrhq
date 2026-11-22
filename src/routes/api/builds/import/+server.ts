import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { importBuildBodySchema, parseJsonBody } from '$lib/server/build-requests';
import { importShareCodeToPlannerSelection } from '$lib/server/loadout-sharing';

// No sign-in required: importing only decodes the code for viewing in the planner,
// nothing is stored until the visitor chooses to save.
export const POST: RequestHandler = async ({ request }) => {
	const body = await parseJsonBody(request, importBuildBodySchema);

	try {
		return json(importShareCodeToPlannerSelection(body.shareCode));
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : 'Failed to import share code';
		error(400, message);
	}
};
