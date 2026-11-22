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

		const text = await response.text();
		return text.includes('is_valid:true');
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

	// Verify user ID matches the one that initiated the flow
	const authUserId = cookies.get('steam_auth_user');
	cookies.delete('steam_auth_user', { path: '/' });

	if (authUserId !== user.id) {
		throw error(400, 'Session mismatch. Please try again.');
	}

	// Check OpenID response
	const mode = url.searchParams.get('openid.mode');
	if (mode === 'cancel') {
		throw redirect(303, '/settings?error=steam_cancelled');
	}

	if (mode !== 'id_res') {
		throw error(400, 'Invalid OpenID response mode');
	}

	// Extract claimed identity
	const claimedId = url.searchParams.get('openid.claimed_id');
	if (!claimedId) {
		throw error(400, 'Missing claimed identity');
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

	// Optional: Fetch Steam profile display name from Web API
	// If STEAM_WEB_API_KEY is not set, we'll just use the SteamID64
	let displayName: string | null = null;
	const steamApiKey = process.env.STEAM_WEB_API_KEY;

	if (steamApiKey) {
		try {
			const apiUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${steamApiKey}&steamids=${steamId}`;
			const apiResponse = await fetch(apiUrl);
			const apiData = await apiResponse.json();

			if (apiData.response?.players?.[0]?.personaname) {
				displayName = apiData.response.players[0].personaname;
			}
		} catch {
			// Ignore API errors - we can still link the account without the display name
		}
	}

	// Store verified Steam ID in profile
	const { error: updateError } = await locals.supabase
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
