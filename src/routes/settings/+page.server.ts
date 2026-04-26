import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

import {
	getUserApiCredentialRecord,
	issueUserApiKey,
	revokeUserApiKey,
	toApiCredentialSummary
} from '$lib/server/api-credentials';
import { isSupabaseAdminConfigured } from '$lib/server/supabase-admin';

async function loadProfile(locals: App.Locals, userId: string) {
	let { data: profile } = await locals.supabase
		.from('profiles')
		.select('display_name')
		.eq('id', userId)
		.single();

	if (!profile) {
		await locals.supabase
			.from('profiles')
			.insert({ id: userId, display_name: '' });
		profile = { display_name: '' };
	}

	return profile;
}

export const load: PageServerLoad = async ({ locals }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) redirect(303, '/auth');

	const profile = await loadProfile(locals, user.id);
	const isOnboarding = !profile.display_name;
	const apiConfigured = isSupabaseAdminConfigured();
	let apiCredential = null;

	if (apiConfigured) {
		try {
			apiCredential = toApiCredentialSummary(await getUserApiCredentialRecord(user.id));
		} catch (caught) {
			console.error('[settings] Failed to load API credential', caught);
		}
	}

	return { profile, isOnboarding, apiConfigured, apiCredential, role };
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
	},

	generateApiKey: async ({ locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { apiError: 'Not authenticated' });
		if (!isSupabaseAdminConfigured()) {
			return fail(503, { apiError: 'API key management is not configured on this server.' });
		}

		const profile = await loadProfile(locals, user.id);
		if (!profile.display_name) {
			return fail(403, {
				apiError: 'Complete your profile before generating an API key.'
			});
		}

		try {
			const result = await issueUserApiKey(user.id);
			return {
				apiSuccess: result.replacedExistingKey
					? 'API key regenerated. The previous key was disabled immediately.'
					: 'API key created.',
				apiKey: result.apiKey,
				apiCredential: toApiCredentialSummary(result.credential)
			};
		} catch (caught) {
			console.error('[settings] Failed to generate API key', caught);
			return fail(500, {
				apiError: 'Unable to generate an API key right now.'
			});
		}
	},

	revokeApiKey: async ({ locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { apiError: 'Not authenticated' });
		if (!isSupabaseAdminConfigured()) {
			return fail(503, { apiError: 'API key management is not configured on this server.' });
		}

		try {
			const apiCredential = await revokeUserApiKey(user.id);
			return {
				apiSuccess: 'API key revoked.',
				apiCredential
			};
		} catch (caught) {
			console.error('[settings] Failed to revoke API key', caught);
			return fail(500, {
				apiError: 'Unable to revoke the API key right now.'
			});
		}
	}
};
