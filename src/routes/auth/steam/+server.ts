/**
 * Steam OpenID 2.0 Authentication
 *
 * Implements Steam OpenID authentication to verify Steam account ownership.
 * Uses the OpenID 2.0 protocol (Steam does not support OAuth or OIDC).
 *
 * Flow:
 * 1. User clicks "Link Steam Account" → GET /auth/steam (initiate)
 * 2. Redirect to Steam OpenID with return URL
 * 3. Steam redirects back to /auth/steam/callback with signed params
 * 4. We verify the signature with Steam's server
 * 5. Extract SteamID64 and store in profile
 *
 * References:
 * - https://steamcommunity.com/dev
 * - https://openid.net/specs/openid-authentication-2_0.html
 */

import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';

/**
 * GET /auth/steam - Initiate Steam OpenID authentication
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		throw error(401, 'You must be logged in to link your Steam account');
	}

	// Build return URL
	const returnUrl = new URL('/auth/steam/callback', url.origin);

	// Generate random state nonce for CSRF protection
	const stateNonce = crypto.randomUUID();

	// Generate OpenID 2.0 request parameters
	const params = new URLSearchParams({
		'openid.ns': 'http://specs.openid.net/auth/2.0',
		'openid.mode': 'checkid_setup',
		'openid.return_to': returnUrl.toString(),
		'openid.realm': url.origin,
		'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
		'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
	});

	// Store session user ID and state nonce in temporary cookies for verification
	cookies.set('steam_auth_user', user.id, {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		maxAge: 600 // 10 minutes
	});

	cookies.set('steam_auth_state', stateNonce, {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		maxAge: 600 // 10 minutes
	});

	// Redirect to Steam
	throw redirect(303, `${STEAM_OPENID_URL}?${params.toString()}`);
};
