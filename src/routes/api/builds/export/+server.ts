import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { exportBuildBodySchema, parseJsonBody } from '$lib/server/build-requests';
import { exportPlannerSelectionToShareCode } from '$lib/server/loadout-sharing';

export const POST: RequestHandler = async ({ request }) => {
	const body = await parseJsonBody(request, exportBuildBodySchema);

	try {
		const shareCode = exportPlannerSelectionToShareCode(body.selection, body.title);
		return json({ shareCode });
	} catch (cause) {
		const message =
			cause instanceof Error ? cause.message : 'Failed to export build to a share code';
		error(400, message);
	}
};
