import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { parseJsonBody } from '$lib/server/submission-requests';
import {
	NotificationError,
	countUnreadNotifications,
	markAllNotificationsRead,
	markNotificationRead
} from '$lib/server/notifications';

const markSchema = z.union([
	z.object({ id: z.string().uuid() }).strict(),
	z.object({ all: z.literal(true) }).strict()
]);

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) error(401, 'Authentication required');

	const body = await parseJsonBody(request, markSchema);
	try {
		if ('all' in body) {
			await markAllNotificationsRead(locals.supabase, user.id);
		} else {
			await markNotificationRead(locals.supabase, user.id, body.id);
		}
		const unreadCount = await countUnreadNotifications(locals.supabase, user.id);
		return json({ unreadCount });
	} catch (err) {
		if (err instanceof NotificationError) error(err.statusCode, err.message);
		throw err;
	}
};
