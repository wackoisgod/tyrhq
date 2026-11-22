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

	// Fetch Steam persona name and update profile
	const { fetchSteamPersonaName } = await import('$lib/server/steam-persona');
	const { getSupabaseAdminClient } = await import('$lib/server/supabase-admin');
	
	const displayName = await fetchSteamPersonaName(steamId);
	const supabaseAdmin = getSupabaseAdminClient();
	
	const { error: updateError } = await supabaseAdmin
		.from('profiles')
		.update({
			verified_steam_id: steamId,
			steam_display_name: displayName,
			steam_verified_at: new Date().toISOString()
		})
		.eq('id', user.id);

	if (updateError) {
		if (updateError.code === '23505') {
			// Unique constraint violation - Steam ID already linked to another account
			throw error(400, 'This Steam account is already linked to another profile');
		}
		throw error(500, 'Failed to link Steam account');
	}

	// Success - redirect to settings
	throw redirect(303, '/settings?success=steam_linked');
};
