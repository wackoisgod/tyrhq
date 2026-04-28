import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

import { loadProfile } from '$lib/server/settings';

export const load: PageServerLoad = async ({ locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) redirect(303, '/auth');

	const profile = await loadProfile(locals, user.id);
	const isOnboarding = !profile.display_name;

	return { profile, isOnboarding, role };
};

export const actions: Actions = {
	updateProfile: async ({ request, locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Not authenticated' });

		const formData = await request.formData();
		const displayName = (formData.get('display_name') as string)?.trim() ?? '';

		if (!displayName) {
			return fail(400, { profileError: 'Display name is required', displayName });
		}

		if (displayName.length > 32) {
			return fail(400, {
				profileError: 'Display name must be 32 characters or less',
				displayName
			});
		}

		const { error } = await locals.supabase
			.from('profiles')
			.update({ display_name: displayName, updated_at: new Date().toISOString() })
			.eq('id', user.id);

		if (error) {
			console.error('[settings] Failed to update profile', error);
			return fail(500, {
				profileError: 'Unable to update profile right now.',
				displayName
			});
		}

		return { profileSuccess: 'Callsign updated.' };
	}
};
