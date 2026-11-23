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
import { computeSignInMethods } from '$lib/server/sign-in-methods';

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

	// Compute sign-in methods for unlink/remove guards
	const signInMethods = computeSignInMethods(user, profile?.verified_steam_id ?? null);

	// Fetch merge history
	const { data: mergeHistory } = await locals.supabase
		.from('user_merge_history')
		.select('*')
		.eq('primary_user_id', user.id)
		.order('merged_at', { ascending: false });

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
		canSetPassword,
		canUnlinkGoogle: signInMethods.canUnlinkGoogle,
		canUnlinkSteam: signInMethods.canUnlinkSteam,
		canRemovePassword: signInMethods.canRemovePassword,
		mergeHistory: mergeHistory || []
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

		// Load profile to get current Steam verification
		const profile = await loadProfile(locals, user.id);
		if (!profile?.verified_steam_id) {
			return fail(400, { profileError: 'No Steam account to unlink' });
		}

		// Server-side guard: Check if user has at least one other sign-in method
		const signInMethods = computeSignInMethods(user, profile.verified_steam_id);
		if (!signInMethods.canUnlinkSteam) {
			return fail(400, {
				profileError:
					'Cannot unlink Steam: you must have at least one other sign-in method (Google or Email+Password) before unlinking Steam.'
			});
		}

		// Use admin client to bypass the Steam column protection trigger
		const { getSupabaseAdminClient } = await import('$lib/server/supabase-admin');
		const supabaseAdmin = getSupabaseAdminClient();
		if (!supabaseAdmin) {
			return fail(500, { profileError: 'Admin client not configured' });
		}

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
	},

	unlinkGoogle: async ({ locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Not authenticated' });

		// Load profile to get Steam verification status
		const profile = await loadProfile(locals, user.id);

		// Server-side guard: Check if user has at least one other sign-in method
		const signInMethods = computeSignInMethods(user, profile?.verified_steam_id ?? null);
		if (!signInMethods.canUnlinkGoogle) {
			return fail(400, {
				profileError:
					'Cannot unlink Google: you must have at least one other sign-in method (Steam or Email+Password) before unlinking Google.'
			});
		}

		// Find Google identity from current user's identities
		const googleIdentity = user.identities?.find((i) => i.provider === 'google');

		if (!googleIdentity) {
			return fail(400, { profileError: 'No Google account to unlink' });
		}

		// Unlink via user-scoped client (requires user session)
		const { error: unlinkError } = await locals.supabase.auth.unlinkIdentity(googleIdentity);

		if (unlinkError) {
			console.error('Error unlinking Google:', unlinkError);
			// Map specific Supabase errors to friendly messages
			if (unlinkError.message?.includes('manual linking')) {
				return fail(400, {
					profileError: 'Manual linking is not enabled. Contact your administrator.'
				});
			}
			if (unlinkError.message?.includes('at least')) {
				return fail(400, {
					profileError:
						'Cannot unlink: you must have at least one other sign-in method first.'
				});
			}
			return fail(500, { profileError: 'Failed to unlink Google account' });
		}

		return { profileSuccess: 'Google account unlinked' };
	},

	removePassword: async ({ locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Not authenticated' });

		// Load profile to get Steam verification status
		const profile = await loadProfile(locals, user.id);

		// Server-side guard: Check if user has at least one other sign-in method
		const signInMethods = computeSignInMethods(user, profile?.verified_steam_id ?? null);
		if (!signInMethods.canRemovePassword) {
			return fail(400, {
				profileError:
					'Cannot remove email+password: you must have at least one other sign-in method (Steam or Google) before removing email+password.'
			});
		}

		// Find email identity from current user's identities
		const emailIdentity = user.identities?.find((i) => i.provider === 'email');

		if (!emailIdentity) {
			return fail(400, { profileError: 'No email identity to remove' });
		}

		// Unlink email identity via user-scoped client (removes password)
		const { error: unlinkError } = await locals.supabase.auth.unlinkIdentity(emailIdentity);

		if (unlinkError) {
			console.error('Error removing password:', unlinkError);
			// Map specific Supabase errors to friendly messages
			if (unlinkError.message?.includes('manual linking')) {
				return fail(400, {
					profileError: 'Manual linking is not enabled. Contact your administrator.'
				});
			}
			if (unlinkError.message?.includes('at least')) {
				return fail(400, {
					profileError: 'Cannot remove: you must have at least one other sign-in method first.'
				});
			}
			return fail(500, { profileError: 'Failed to remove email+password' });
		}

		return { profileSuccess: 'Email+password removed' };
	}
};
