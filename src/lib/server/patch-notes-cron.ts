import { error, json } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';

import { runPatchNoteSync, type PatchNoteSyncRequest } from './patch-notes-runner';

/**
 * Shared body of the scheduled patch note sync routes.
 *
 * Authorised solely by `CRON_SECRET`, which Vercel Cron sends as
 * `Authorization: Bearer …` (see the `crons` entries in vercel.json). With no
 * secret configured the route refuses to run rather than standing open as an
 * unauthenticated write endpoint. The same call works by hand:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/patch-notes
 */
export async function handlePatchNoteCron(
	request: Request,
	url: URL,
	defaults: PatchNoteSyncRequest = {}
) {
	const secret = privateEnv.CRON_SECRET?.trim();
	if (!secret) {
		error(503, 'Scheduled patch note sync is not configured (set CRON_SECRET).');
	}
	if (request.headers.get('authorization') !== `Bearer ${secret}`) {
		error(401, 'Invalid cron credentials');
	}

	const result = await runPatchNoteSync({
		full: defaults.full || url.searchParams.get('full') === '1',
		force: defaults.force || url.searchParams.get('force') === '1'
	});

	if (!result.ok) {
		// 502 when the official site is the problem, 500 when we are.
		error(result.kind === 'upstream' ? 502 : 500, result.error);
	}

	const { report } = result;
	// Deliberately terse: cron logs are read as a stream, and the per-note
	// detail is already in the server log when something needed attention.
	return json({
		ok: true,
		origin: report.origin,
		checked: report.checked,
		created: report.created,
		updated: report.updated,
		adopted: report.adopted,
		unchanged: report.unchanged,
		skipped: report.skipped,
		failed: report.failed,
		problems: report.entries
			.filter((entry) => entry.outcome === 'failed' || entry.outcome === 'skipped')
			.map((entry) => ({ note: entry.sourceKey, outcome: entry.outcome, reason: entry.reason }))
	});
}
