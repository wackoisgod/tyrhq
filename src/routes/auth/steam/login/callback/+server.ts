/**
 * Steam OpenID 2.0 Authentication Callback - Sign In Flow
 *
 * Handles the return from Steam OpenID authentication for sign-in.
 * Verifies the signature, looks up the Steam ID, and creates a session.
 */

import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdminClient } from '$lib/server/supabase-admin';
import { sanitizePostAuthRedirect } from '$lib/server/security';
import { fetchSteamPersonaName, updateProfileWithPersona } from '$lib/server/steam-persona';

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
const STEAM_ID_REGEX = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;
const STEAM_API_TIMEOUT_MS = 3000;

/**
 * Constant-time string comparison to prevent timing attacks
 * Manual implementation safe for edge/serverless environments
 */
function constantTimeCompare(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}
	
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	
	return result === 0;
}

/**
 * Extract SteamID64 from claimed_id URL
 */
function extractSteamId(claimedId: string): string | null {
	const match = claimedId.match(STEAM_ID_REGEX);
	return match ? match[1] : null;
}

/**
 * Sanitize Steam persona name for use as display name
 */
function sanitizePersonaName(name: string | null | undefined): string | null {
	if (!name) return null;
	
	// Trim whitespace
	let sanitized = name.trim();
	
	// Remove control characters
	sanitized = sanitized.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
	
	// Cap length at 32 characters (profile limit)
	if (sanitized.length > 32) {
		sanitized = sanitized.slice(0, 32);
	}
	
	return sanitized || null;
}

/**
 * Escape SQL LIKE pattern wildcards
 */
function escapeLikePattern(str: string): string {
	return str.replace(/[%_]/g, '\\$&');
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

	// SECURITY: Verify state nonce with constant-time comparison
	const stateParam = url.searchParams.get('state');
	if (!stateParam) {
		throw error(400, 'Missing state parameter. Please try again.');
	}
	
	if (!constantTimeCompare(stateParam, state.nonce)) {
		throw error(400, 'Invalid state nonce. Possible CSRF attack.');
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

	// SECURITY: Validate return_to matches our callback URL with state nonce
	const returnTo = url.searchParams.get('openid.return_to');
	const expectedReturnTo = new URL('/auth/steam/login/callback', url.origin);
	expectedReturnTo.searchParams.set('state', state.nonce);
	
	if (returnTo !== expectedReturnTo.toString()) {
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

	// Look up existing account by verified_steam_id
	// This works even if user changed email from placeholder to real email
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
	let isReturningUser = false;

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
			// IDEMPOTENT: Check if user already exists (stuck-account recovery)
			// Use generateLink to lookup by email - returns user data if exists
			const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
				type: 'magiclink',
				email: placeholderEmail
			});

			let existingUserId: string | null = null;
			if (!linkError && linkData?.user?.id) {
				// User exists - generateLink returns the user object
				existingUserId = linkData.user.id;
			}

			// Also try to find profile by Steam ID (may exist from race condition)
			const { data: retryProfile } = await supabaseAdmin
				.from('profiles')
				.select('id, display_name')
				.eq('verified_steam_id', steamId)
				.maybeSingle();

			if (retryProfile) {
				// Profile exists with Steam ID already set
				profile = retryProfile;
				userId = retryProfile.id;
			} else if (existingUserId) {
				// User exists but profile needs initialization - complete the setup
				userId = existingUserId;
			} else {
				console.error('[steam-login] User creation failed:', createError);
				throw error(500, 'Failed to create account');
			}
		} else {
			userId = newUser!.user.id;
		}

		if (!profile) {
			// Need to initialize profile (either new user or stuck-account recovery)
			// Fetch persona name and generate fallback if needed
			const steamDisplayName = await fetchSteamPersonaName(steamId);
			const baseDisplayName = steamDisplayName || `Player_${steamId.slice(-6)}`;
			
			// Import helper functions for deduplication
			const { escapeLikePattern, deduplicateDisplayName } = await import('$lib/server/steam-persona');
			let displayName = baseDisplayName;
			let attempt = 0;
			const maxAttempts = 10;

			// Deduplicate username with exact case-insensitive comparison
			while (attempt < maxAttempts) {
				const escapedPattern = escapeLikePattern(displayName);
				const { data: existingProfiles, error: checkError } = await supabaseAdmin
					.from('profiles')
					.select('id')
					.ilike('display_name', escapedPattern)
					.limit(10);

				// Fail closed: if dedupe query errors, throw instead of proceeding
				if (checkError) {
					console.error('[steam-login] Display name deduplication failed:', checkError);
					throw error(500, 'Failed to check display name availability');
				}

				// No matches found - name is available
				if (!existingProfiles || existingProfiles.length === 0) {
					break;
				}

				// Name taken, try next
				attempt++;
				displayName = `${baseDisplayName}${attempt}`;
			}

			// Upsert profile with Steam data (handles both update and insert)
			const { error: upsertError, count } = await supabaseAdmin
				.from('profiles')
				.upsert(
					{
						id: userId,
						display_name: displayName,
						verified_steam_id: steamId,
						steam_display_name: steamDisplayName,
						steam_verified_at: new Date().toISOString()
					},
					{
						onConflict: 'id'
					}
				);

			if (upsertError) {
				console.error('[steam-login] Profile upsert failed:', upsertError);
				throw error(500, 'Failed to initialize account');
			}
		}
	} else {
		userId = profile.id;
		isReturningUser = true;
	}

	// For returning users, refresh persona name (may have changed on Steam)
	if (isReturningUser && profile) {
		try {
			await updateProfileWithPersona(userId, steamId, profile.display_name);
		} catch (err) {
			// Log but don't fail login if persona update fails
			console.warn('[steam-login] Failed to update persona for returning user:', err);
		}
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

	// Success - redirect to next or home (defense in depth: re-sanitize)
	const redirectTarget = sanitizePostAuthRedirect(state.next);
	throw redirect(303, redirectTarget);
};
