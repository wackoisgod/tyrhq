/**
 * Steam OpenID 2.0 Authentication - Sign In Flow
 *
 * Implements Steam OpenID authentication for signing in with an existing account.
 * Uses the OpenID 2.0 protocol (Steam does not support OAuth or OIDC).
 *
 * Flow:
 * 1. User clicks "Continue with Steam" → GET /auth/steam/login (initiate)
 * 2. Redirect to Steam OpenID with return URL
 * 3. Steam redirects back to /auth/steam/login/callback with signed params
 * 4. We verify the signature with Steam's server
 * 5. Look up profiles.verified_steam_id and create session
 *
 * References:
 * - https://steamcommunity.com/dev
 * - https://openid.net/specs/openid-authentication-2_0.html
 */

import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sanitizePostAuthRedirect } from '$lib/server/security';

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';

/**
 * GET /auth/steam/login - Initiate Steam OpenID authentication for sign-in
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	// Get optional redirect target
	const next = sanitizePostAuthRedirect(url.searchParams.get('next'));
	
	// Check if this is a merge flow
	const isMergeFlow = url.searchParams.get('merge') === '1';

	// Generate random state nonce for CSRF protection
	const stateNonce = crypto.randomUUID();

	// Build return URL with state nonce
	const returnUrl = new URL('/auth/steam/login/callback', url.origin);
	returnUrl.searchParams.set('state', stateNonce);

	// Encode the mode, next path, and merge flag in the state
	const state = JSON.stringify({ mode: 'login', next, nonce: stateNonce, merge: isMergeFlow });

	// Generate OpenID 2.0 request parameters
	const params = new URLSearchParams({
		'openid.ns': 'http://specs.openid.net/auth/2.0',
		'openid.mode': 'checkid_setup',
		'openid.return_to': returnUrl.toString(),
		'openid.realm': url.origin,
		'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
		'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
	});

	// Store state nonce in temporary cookie for verification
	cookies.set('steam_login_state', state, {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		maxAge: 600 // 10 minutes
	});

	// Redirect to Steam
	throw redirect(303, `${STEAM_OPENID_URL}?${params.toString()}`);
};
