import { handlePatchNoteCron } from '$lib/server/patch-notes-cron';
import type { RequestHandler } from './$types';

/**
 * Hourly patch note sync. Reads the newest page of the official index, which
 * always covers a new release plus a same-day hotfix. `?full=1` widens it to
 * the whole archive; /api/cron/patch-notes/full does that on a schedule.
 */
export const GET: RequestHandler = ({ request, url }) => handlePatchNoteCron(request, url);
export const POST: RequestHandler = ({ request, url }) => handlePatchNoteCron(request, url);
