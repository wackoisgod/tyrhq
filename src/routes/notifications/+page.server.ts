import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isSafeAppPath } from '$lib/notifications';
import {
	NotificationError,
	listMyNotifications,
	markAllNotificationsRead,
	markNotificationRead
} from '$lib/server/notifications';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) redirect(303, '/auth');
	if (!locals.supabase) return { available: false, notifications: [] };
	return listMyNotifications(locals.supabase, user.id, 50);
};

async function requireUser(locals: App.Locals) {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user || !locals.supabase) redirect(303, '/auth');
	return { supabase: locals.supabase, userId: user.id };
}

function actionError(err: unknown) {
	if (err instanceof NotificationError) return fail(err.statusCode, { error: err.message });
	throw err;
}

export const actions: Actions = {
	read: async ({ request, locals }) => {
		const { supabase, userId } = await requireUser(locals);
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const nextRaw = String(form.get('next') ?? '');
		if (!UUID_PATTERN.test(id)) return fail(400, { error: 'That notification could not be updated.' });
		try {
			await markNotificationRead(supabase, userId, id);
		} catch (err) {
			return actionError(err);
		}
		if (isSafeAppPath(nextRaw)) redirect(303, nextRaw);
		return { marked: true };
	},
	readAll: async ({ locals }) => {
		const { supabase, userId } = await requireUser(locals);
		try {
			await markAllNotificationsRead(supabase, userId);
		} catch (err) {
			return actionError(err);
		}
		return { markedAll: true };
	}
};
