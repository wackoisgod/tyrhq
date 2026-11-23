/**
 * Steam OpenID 2.0 Authentication Callback
 *
 * Handles the return from Steam OpenID authentication.
 * Verifies the signature and extracts the SteamID64.
 */

import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdminClient } from '$lib/server/supabase-admin';

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
const STEAM_ID_REGEX = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;

/**
 * Extract SteamID64 from claimed_id URL
 */
function extractSteamId(claimedId: string): string | null {
	const match = claimedId.match(STEAM_ID_REGEX);
	return match ? match[1] : null;
}

/**
 * Verify OpenID response with Steam
 */
async function verifyOpenIdSignature(params: URLSearchParams): Promise<boolean> {
	// Change mode to check_authentication
	const verifyParams = new URLSearchParams(params);
	verifyParams.set('openid.mode', 'check_authentication');

	try {
		const response = await fetch(STEAM_OPENID_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: verifyParams.toString()
		});

		if (!response.ok) {
			return false;
		}

		const text = await response.text();
		
		// Parse line by line and require exact is_valid:true line
		const lines = text.split('\n');
		for (const line of lines) {
			if (line.trim() === 'is_valid:true') {
				return true;
			}
		}
		
		return false;
	} catch {
		return false;
	}
}

/**
 * GET /auth/steam/callback - Handle Steam OpenID return
 */
export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		throw error(401, 'Session expired. Please try again.');
	}

	// Verify user ID and state nonce match the ones that initiated the flow
	const authUserId = cookies.get('steam_auth_user');
	const authState = cookies.get('steam_auth_state');
	
	cookies.delete('steam_auth_user', { path: '/' });
	cookies.delete('steam_auth_state', { path: '/' });

	if (authUserId !== user.id) {
		throw error(400, 'Session mismatch. Please try again.');
	}

	if (!authState) {
		throw error(400, 'Missing state token. Please try again.');
	}

	// Check OpenID response
	const mode = url.searchParams.get('openid.mode');
	if (mode === 'cancel') {
		throw redirect(303, '/settings?error=steam_cancelled');
	}

	if (mode !== 'id_res') {
		throw error(400, 'Invalid OpenID response mode');
	}

	// SECURITY: Validate op_endpoint before proceeding
	const opEndpoint = url.searchParams.get('openid.op_endpoint');
	if (opEndpoint !== STEAM_OPENID_URL) {
		throw error(400, 'Invalid OpenID provider endpoint');
	}

	// SECURITY: Validate return_to matches our callback URL
	const returnTo = url.searchParams.get('openid.return_to');
	const expectedReturnTo = new URL('/auth/steam/callback', url.origin).toString();
	if (returnTo !== expectedReturnTo) {
		throw error(400, 'Invalid return URL');
	}

	// Extract claimed identity and identity
	const claimedId = url.searchParams.get('openid.claimed_id');
	const identity = url.searchParams.get('openid.identity');
	
	if (!claimedId || !identity) {
		throw error(400, 'Missing claimed identity');
	}

	// SECURITY: Require claimed_id === identity
	if (claimedId !== identity) {
		throw error(400, 'Identity mismatch');
	}

	const steamId = extractSteamId(claimedId);
	if (!steamId) {
		throw error(400, 'Invalid Steam identity format');
	}

	// Verify signature with Steam
	const isValid = await verifyOpenIdSignature(url.searchParams);
	if (!isValid) {
		throw error(400, 'Steam signature verification failed');
	}

	// Check if user already has a different Steam ID
	const { loadProfile } = await import('$lib/server/settings');
	const currentProfile = await loadProfile(locals, user.id);
	
	if (currentProfile?.verified_steam_id && currentProfile.verified_steam_id !== steamId) {
		// User is trying to link a DIFFERENT Steam account - this is a conflict
		throw error(400, 'You already have a different Steam account linked. Cannot link multiple Steam accounts.');
	}
	
	if (currentProfile?.verified_steam_id === steamId) {
		// User is re-linking the same Steam account - allow as no-op
		throw redirect(303, '/settings?success=steam_linked');
	}

	// Check if this Steam ID is already linked to ANOTHER user
	const { getSupabaseAdminClient } = await import('$lib/server/supabase-admin');
	const supabaseAdmin = getSupabaseAdminClient();
	
	const { data: existingProfile, error: lookupError } = await supabaseAdmin
		.from('profiles')
		.select('id')
		.eq('verified_steam_id', steamId)
		.maybeSingle();
	
	if (lookupError) {
		console.error('[steam-callback] Profile lookup failed:', lookupError);
		throw error(500, 'Failed to check Steam account');
	}
	
	if (existingProfile && existingProfile.id !== user.id) {
		// Steam ID belongs to another account - initiate merge flow
		const { createMergeCookie, MERGE_COOKIE_NAME } = await import('$lib/server/account-merge');
		
		// Set merge cookie with current user as primary
		const { value, options } = createMergeCookie(user.id);
		cookies.set(MERGE_COOKIE_NAME, value, options);
		
		// Sign out current user
		await locals.supabase.auth.signOut();
		
		// Redirect to Steam login for re-authentication (user will sign in as secondary account)
		throw redirect(303, '/auth/steam/login?merge=1');
	}
	
	// No conflict - proceed with normal linking
	const { fetchSteamPersonaName } = await import('$lib/server/steam-persona');
	const displayName = await fetchSteamPersonaName(steamId);
	
	const { error: updateError } = await supabaseAdmin
		.from('profiles')
		.update({
			verified_steam_id: steamId,
			steam_display_name: displayName,
			steam_verified_at: new Date().toISOString()
		})
		.eq('id', user.id);

	if (updateError) {
		console.error('[steam-callback] Failed to link Steam:', updateError);
		
		// Handle race condition: Steam ID was just linked by another request
		if (updateError.code === '23505') {
			// Check again if it belongs to this user or another
			const { data: recheckProfile } = await supabaseAdmin
				.from('profiles')
				.select('id')
				.eq('verified_steam_id', steamId)
				.maybeSingle();
			
			if (recheckProfile && recheckProfile.id !== user.id) {
				// Another account claimed it - initiate merge flow
				const { createMergeCookie, MERGE_COOKIE_NAME } = await import('$lib/server/account-merge');
				const { value, options } = createMergeCookie(user.id);
				cookies.set(MERGE_COOKIE_NAME, value, options);
				await locals.supabase.auth.signOut();
				throw redirect(303, '/auth/steam/login?merge=1');
			}
			
			// Same user somehow - treat as success
			throw redirect(303, '/settings?success=steam_linked');
		}
		
		throw error(500, 'Failed to link Steam account');
	}

	// Success - redirect to settings
	throw redirect(303, '/settings?success=steam_linked');
};
