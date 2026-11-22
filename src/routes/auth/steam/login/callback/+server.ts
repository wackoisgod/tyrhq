/**
 * Steam OpenID 2.0 Authentication Callback - Sign In Flow
 *
 * Handles the return from Steam OpenID authentication for sign-in.
 * Verifies the signature, looks up the Steam ID, and creates a session.
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
 * GET /auth/steam/login/callback - Handle Steam OpenID return for sign-in
 */
export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	// Retrieve and clear state cookie
	const stateJson = cookies.get('steam_login_state');
	cookies.delete('steam_login_state', { path: '/' });

	if (!stateJson) {
		throw error(400, 'Missing state token. Please try again.');
	}

	let state: { mode: string; next: string; nonce: string };
	try {
		state = JSON.parse(stateJson);
	} catch {
		throw error(400, 'Invalid state token. Please try again.');
	}

	// Verify this is a login flow (not a link flow)
	if (state.mode !== 'login') {
		throw error(400, 'Invalid authentication mode.');
	}

	// Check OpenID response
	const mode = url.searchParams.get('openid.mode');
	if (mode === 'cancel') {
		throw redirect(303, '/auth?error=steam_cancelled');
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
	const expectedReturnTo = new URL('/auth/steam/login/callback', url.origin).toString();
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

	// Look up or create account with verified_steam_id using admin client
	const supabaseAdmin = getSupabaseAdminClient();
	if (!supabaseAdmin) {
		throw error(500, 'Authentication service not configured');
	}

	// Fetch Steam profile display name from Web API
	let steamDisplayName: string | null = null;
	const steamApiKey = process.env.STEAM_WEB_API_KEY;

	if (steamApiKey) {
		try {
			const apiUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${steamApiKey}&steamids=${steamId}`;
			const apiResponse = await fetch(apiUrl);
			const apiData = await apiResponse.json();

			if (apiData.response?.players?.[0]?.personaname) {
				steamDisplayName = apiData.response.players[0].personaname;
			}
		} catch (err) {
			console.warn('[steam-login] Failed to fetch Steam display name:', err);
		}
	}

	// Look up existing account by verified_steam_id
	let { data: profile, error: profileError } = await supabaseAdmin
		.from('profiles')
		.select('id, display_name')
		.eq('verified_steam_id', steamId)
		.maybeSingle();

	if (profileError) {
		console.error('[steam-login] Profile lookup failed:', profileError);
		throw error(500, 'Failed to look up account');
	}

	let userId: string;

	if (!profile) {
		// No existing account - create new user server-side
		const placeholderEmail = `steam_${steamId}@users.tyrhq.invalid`;

		// Create auth user with admin client
		const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
			email: placeholderEmail,
			email_confirm: true,
			user_metadata: {
				provider: 'steam',
				steam_id: steamId
			}
		});

		if (createError) {
			// Check for race condition - another concurrent request may have created this user
			if (createError.message?.includes('already') || createError.code === '23505') {
				// Retry lookup
				const { data: retryProfile } = await supabaseAdmin
					.from('profiles')
					.select('id, display_name')
					.eq('verified_steam_id', steamId)
					.maybeSingle();

				if (retryProfile) {
					profile = retryProfile;
					userId = retryProfile.id;
				} else {
					console.error('[steam-login] User creation failed (race condition unresolved):', createError);
					throw error(500, 'Failed to create account');
				}
			} else {
				console.error('[steam-login] User creation failed:', createError);
				throw error(500, 'Failed to create account');
			}
		}

		if (!profile) {
			userId = newUser!.user.id;

			// Generate display name from Steam persona name
			const baseDisplayName = steamDisplayName || `Player_${steamId.slice(-6)}`;
			let displayName = baseDisplayName;
			let attempt = 0;
			const maxAttempts = 10;

			// Deduplicate username
			while (attempt < maxAttempts) {
				const { data: existing } = await supabaseAdmin
					.from('profiles')
					.select('id')
					.ilike('display_name', displayName)
					.maybeSingle();

				if (!existing) {
					break;
				}

				attempt++;
				displayName = `${baseDisplayName}${attempt}`;
			}

			// Update profile with Steam data
			const { error: updateError } = await supabaseAdmin
				.from('profiles')
				.update({
					display_name: displayName,
					verified_steam_id: steamId,
					steam_display_name: steamDisplayName,
					steam_verified_at: new Date().toISOString()
				})
				.eq('id', userId);

			if (updateError) {
				console.error('[steam-login] Profile update failed:', updateError);
				throw error(500, 'Failed to initialize account');
			}
		}
	} else {
		userId = profile.id;
	}

	// Get user email for session creation
	const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);

	if (authError || !authUser?.user?.email) {
		console.error('[steam-login] User lookup failed:', authError);
		throw error(500, 'Failed to retrieve account details');
	}

	// Generate a magic link token (we only need the hashed token, not the email link)
	const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
		type: 'magiclink',
		email: authUser.user.email
	});

	if (linkError || !linkData?.properties?.hashed_token) {
		console.error('[steam-login] Token generation failed:', linkError);
		throw error(500, 'Failed to create session');
	}

	// Verify the OTP using the user's SSR client to set session cookies
	const { error: sessionError } = await locals.supabase.auth.verifyOtp({
		type: 'magiclink',
		token_hash: linkData.properties.hashed_token
	});

	if (sessionError) {
		console.error('[steam-login] Session creation failed:', sessionError);
		throw error(500, 'Failed to establish session');
	}

	// Success - redirect to next or home
	throw redirect(303, state.next || '/');
};
