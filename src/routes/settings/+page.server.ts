import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

import { loadProfile } from '$lib/server/settings';
import {
	CommunityEventError,
	getEventForActor,
	listEventsForUser,
	type CommunityEventRecord
} from '$lib/server/events';
import { isSupabaseAdminConfigured } from '$lib/server/supabase-admin';

export const load: PageServerLoad = async ({ locals, url }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) redirect(303, '/auth');

	const profile = await loadProfile(locals, user.id);
	const isOnboarding = !profile.display_name;

	// Deep link from the public calendar's "Edit" action (?editEvent=<id>)
	// prefills the My Events form.
	const editId = url.searchParams.get('editEvent');
	let editEvent: CommunityEventRecord | null = null;
	if (editId) {
		try {
			editEvent = await getEventForActor(editId, { id: user.id, role });
		} catch (err) {
			if (err instanceof CommunityEventError) throw error(err.statusCode, err.message);
			throw err;
		}
	}

	const events = await listEventsForUser(user.id);

	// Get linked identities from admin client
	const { getSupabaseAdminClient } = await import('$lib/server/supabase-admin');
	const supabaseAdmin = getSupabaseAdminClient();
	let linkedIdentities: { provider: string; email?: string }[] = [];

	if (supabaseAdmin) {
		const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(user.id);
		linkedIdentities = (authUser?.user?.identities || []).map((identity: any) => ({
			provider: identity.provider,
			email: identity.identity_data?.email
		}));
	}

	// Determine if user has a real email (not placeholder)
	const hasRealEmail = user.email && !user.email.endsWith('@users.tyrhq.invalid');
	
	// Check if user has email provider identity
	const hasEmailIdentity = linkedIdentities.some((i) => i.provider === 'email');
	
	// Email+password counts as a usable sign-in method ONLY when:
	// - Email is real (not placeholder) AND
	// - Email identity exists (password is set)
	const hasEmailPassword = hasRealEmail && hasEmailIdentity;
	
	// User can set a password if they have real email (from OAuth or confirmed)
	// Note: After updateUser({password}), Supabase doesn't create a new identity for OAuth users
	// The password is added to their existing account, so we show "Set password" for any real-email user
	const canSetPassword = hasRealEmail;

	return {
		profile,
		isOnboarding,
		role,
		events,
		editEvent,
		eventsEnabled: isSupabaseAdminConfigured(),
		linkedIdentities,
		hasRealEmail,
		userEmail: user.email,
		hasEmailIdentity,
		hasEmailPassword,
		canSetPassword
	};
};

export const actions: Actions = {
	updateProfile: async ({ request, locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Not authenticated' });

		const formData = await request.formData();
		const displayName = (formData.get('display_name') as string)?.trim() ?? '';
		const discordHandle = (formData.get('discord_handle') as string)?.trim() ?? '';
		const steamProfile = (formData.get('steam_profile') as string)?.trim() ?? '';

		if (!displayName) {
			return fail(400, { profileError: 'Display name is required', displayName, discordHandle, steamProfile });
		}

		if (displayName.length > 32) {
			return fail(400, {
				profileError: 'Display name must be 32 characters or less',
				displayName,
				discordHandle,
				steamProfile
			});
		}

		if (discordHandle.length > 100) {
			return fail(400, {
				profileError: 'Discord handle must be 100 characters or less',
				displayName,
				discordHandle,
				steamProfile
			});
		}

		if (steamProfile.length > 200) {
			return fail(400, {
				profileError: 'Steam profile must be 200 characters or less',
				displayName,
				discordHandle,
				steamProfile
			});
		}

		const { error } = await locals.supabase
			.from('profiles')
			.update({ 
				display_name: displayName,
				discord_handle: discordHandle || null,
				steam_profile: steamProfile || null,
				updated_at: new Date().toISOString() 
			})
			.eq('id', user.id);

		if (error) {
			console.error('[settings] Failed to update profile', error);
			return fail(500, {
				profileError: 'Unable to update profile right now.',
				displayName,
				discordHandle,
				steamProfile
			});
		}

		return { profileSuccess: 'Profile updated.' };
	},

	unlinkSteam: async ({ locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Not authenticated' });

		// Use admin client to bypass the Steam column protection trigger
		const { getSupabaseAdminClient } = await import('$lib/server/supabase-admin');
		const supabaseAdmin = getSupabaseAdminClient();

		const { error: updateError } = await supabaseAdmin
			.from('profiles')
			.update({
				verified_steam_id: null,
				steam_display_name: null,
				steam_verified_at: null
			})
			.eq('id', user.id);

		if (updateError) {
			console.error('Error unlinking Steam:', updateError);
			return fail(500, { profileError: 'Failed to unlink Steam account' });
		}

		return { profileSuccess: 'Steam account unlinked' };
	}
};
