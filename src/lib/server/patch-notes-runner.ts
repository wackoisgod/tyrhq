/**
 * Shared entry point for the three ways a patch note sync gets started: the
 * scheduled cron hit, the admin button, and a local `curl`. Keeps the
 * "one at a time" rule and the report-shaping in one place so those callers
 * stay thin.
 */

import {
	PatchNoteSyncError,
	syncOfficialPatchNotes,
	type PatchNoteSyncOptions,
	type PatchNoteSyncReport
} from './patch-notes-sync';
import { PatchNoteSourceError } from './patch-notes-source';

/**
 * Pages to read on a routine run. The official index is newest-first at five
 * notes a page, so one page always covers a new release and a same-day hotfix;
 * a backfill asks for everything.
 */
export const INCREMENTAL_PAGES = 1;

export interface PatchNoteSyncRequest {
	/** Walk the whole official archive rather than just the newest page. */
	full?: boolean;
	/** Re-render and rewrite even notes whose upstream hash is unchanged. */
	force?: boolean;
}

export type PatchNoteSyncResult =
	| { ok: true; report: PatchNoteSyncReport; alreadyRunning?: false }
	| { ok: false; error: string; kind: 'upstream' | 'store' | 'busy' | 'unknown' };

/**
 * A sync in flight. Two overlapping runs are safe at the database level (the
 * unique index on (source, source_key) turns a racing insert into a reported
 * failure rather than a duplicate note), but they are pure waste — an admin
 * double-clicking should join the run already going, not start a second one.
 */
let inFlight: Promise<PatchNoteSyncReport> | null = null;

export function isPatchNoteSyncRunning(): boolean {
	return inFlight !== null;
}

export async function runPatchNoteSync(
	request: PatchNoteSyncRequest = {},
	overrides: PatchNoteSyncOptions = {}
): Promise<PatchNoteSyncResult> {
	if (inFlight) {
		try {
			return { ok: true, report: await inFlight };
		} catch {
			return { ok: false, error: 'A patch note sync was already running and failed.', kind: 'busy' };
		}
	}

	const options: PatchNoteSyncOptions = {
		maxPages: request.full ? undefined : INCREMENTAL_PAGES,
		force: request.force ?? false,
		...overrides
	};

	const run = syncOfficialPatchNotes(options);
	inFlight = run;

	try {
		const report = await run;
		console.log(
			`[patch-notes-sync] checked ${report.checked} · created ${report.created} · ` +
				`updated ${report.updated} · adopted ${report.adopted} · unchanged ${report.unchanged} · ` +
				`skipped ${report.skipped} · failed ${report.failed}`
		);
		return { ok: true, report };
	} catch (err) {
		console.error('[patch-notes-sync] run failed', err);
		if (err instanceof PatchNoteSourceError) {
			return { ok: false, error: err.message, kind: 'upstream' };
		}
		if (err instanceof PatchNoteSyncError) {
			return { ok: false, error: err.message, kind: 'store' };
		}
		return {
			ok: false,
			error: err instanceof Error ? err.message : 'Patch note sync failed.',
			kind: 'unknown'
		};
	} finally {
		inFlight = null;
	}
}
