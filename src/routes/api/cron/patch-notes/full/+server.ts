import { handlePatchNoteCron } from '$lib/server/patch-notes-cron';
import type { RequestHandler } from './$types';

/**
 * Daily full-archive sync.
 *
 * The hourly run only reads the newest index page, so an upstream correction
 * to an older note would otherwise never be noticed. This walks every page.
 * It exists as its own route rather than a query string on the hourly one so
 * the cron schedule doesn't depend on query strings surviving the platform's
 * cron config.
 */
export const GET: RequestHandler = ({ request, url }) =>
	handlePatchNoteCron(request, url, { full: true });
export const POST: RequestHandler = ({ request, url }) =>
	handlePatchNoteCron(request, url, { full: true });
