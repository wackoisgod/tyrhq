import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

import {
	getUserApiCredentialRecord,
	issueUserApiKey,
	revokeUserApiKey,
	toApiCredentialSummary
} from '$lib/server/api-credentials';
import { loadProfile } from '$lib/server/settings';
import { isSupabaseAdminConfigured } from '$lib/server/supabase-admin';

export const load: PageServerLoad = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) redirect(303, '/auth');

	const profile = await loadProfile(locals, user.id);
	if (!profile.display_name) redirect(303, '/settings');

	const apiConfigured = isSupabaseAdminConfigured();
	let apiCredential = null;

	if (apiConfigured) {
		try {
			apiCredential = toApiCredentialSummary(await getUserApiCredentialRecord(user.id));
		} catch (caught) {
			console.error('[settings/api] Failed to load API credential', caught);
		}
	}

	return { profile, apiConfigured, apiCredential };
};

export const actions: Actions = {
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
			console.error('[settings/api] Failed to generate API key', caught);
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
			console.error('[settings/api] Failed to revoke API key', caught);
			return fail(500, {
				apiError: 'Unable to revoke the API key right now.'
			});
		}
	}
};
