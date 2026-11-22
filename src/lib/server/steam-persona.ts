/**
 * Steam Persona Name Management
 *
 * Handles fetching and updating Steam display names from the Web API.
 */

import { env } from '$env/dynamic/private';
import { getSupabaseAdminClient } from './supabase-admin';

const STEAM_API_TIMEOUT_MS = 3000;
const FALLBACK_NAME_PATTERN = /^Player_\d{6}$/;

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
export function escapeLikePattern(str: string): string {
	return str.replace(/[%_]/g, '\\$&');
}

/**
 * Check if a display name matches the auto-generated fallback pattern
 */
export function isFallbackDisplayName(name: string | null | undefined): boolean {
	if (!name) return false;
	return FALLBACK_NAME_PATTERN.test(name);
}

/**
 * Fetch Steam persona name from Web API
 * Returns null if API key not set, fetch fails, or no persona name found
 */
export async function fetchSteamPersonaName(steamId: string): Promise<string | null> {
	const steamApiKey = env.STEAM_WEB_API_KEY;

	if (!steamApiKey) {
		console.warn('[steam-persona] STEAM_WEB_API_KEY is not set - cannot fetch persona names');
		return null;
	}

	try {
		const apiUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${steamApiKey}&steamids=${steamId}`;
		const apiResponse = await fetch(apiUrl, {
			signal: AbortSignal.timeout(STEAM_API_TIMEOUT_MS)
		});
		
		if (!apiResponse.ok) {
			console.warn('[steam-persona] Steam API returned HTTP', apiResponse.status);
			return null;
		}

		const apiData = await apiResponse.json();
		
		if (!apiData.response?.players || apiData.response.players.length === 0) {
			console.warn('[steam-persona] Steam API returned empty players array for', steamId);
			return null;
		}

		const personaName = apiData.response.players[0]?.personaname;
		if (!personaName) {
			console.warn('[steam-persona] Steam API player missing personaname field');
			return null;
		}

		return sanitizePersonaName(personaName);
	} catch (err) {
		if (err instanceof Error && err.name === 'TimeoutError') {
			console.warn('[steam-persona] Steam API request timed out after', STEAM_API_TIMEOUT_MS, 'ms');
		} else {
			console.warn('[steam-persona] Failed to fetch Steam persona:', err);
		}
		return null;
	}
}

/**
 * Deduplicate display name by checking for existing profiles
 * Returns a unique display name with numeric suffix if needed
 */
async function deduplicateDisplayName(baseDisplayName: string): Promise<string> {
	const supabaseAdmin = getSupabaseAdminClient();
	if (!supabaseAdmin) {
		return baseDisplayName;
	}

	let displayName = baseDisplayName;
	let attempt = 0;
	const maxAttempts = 10;

	while (attempt < maxAttempts) {
		const escapedPattern = escapeLikePattern(displayName);
		const { data: existingProfiles, error: checkError } = await supabaseAdmin
			.from('profiles')
			.select('id')
			.ilike('display_name', escapedPattern)
			.limit(10);

		// Fail closed: if dedupe query errors, throw instead of proceeding
		if (checkError) {
			console.error('[steam-persona] Display name deduplication failed:', checkError);
			throw new Error('Failed to check display name availability');
		}

		// No matches found - name is available
		if (!existingProfiles || existingProfiles.length === 0) {
			break;
		}

		// Name taken, try next
		attempt++;
		displayName = `${baseDisplayName}${attempt}`;
	}

	return displayName;
}

/**
 * Update profile with Steam persona name
 * - Always updates steam_display_name
 * - Only updates display_name if it's still a fallback pattern (Player_######)
 * - Never overwrites user-chosen names
 */
export async function updateProfileWithPersona(
	userId: string,
	steamId: string,
	currentDisplayName: string | null
): Promise<void> {
	const supabaseAdmin = getSupabaseAdminClient();
	if (!supabaseAdmin) {
		throw new Error('Supabase admin client not configured');
	}

	// Fetch fresh persona name
	const steamDisplayName = await fetchSteamPersonaName(steamId);

	// Determine if we should update the display_name field
	let newDisplayName: string | null = null;
	
	if (steamDisplayName && isFallbackDisplayName(currentDisplayName)) {
		// User still has fallback name - replace it with persona name
		newDisplayName = await deduplicateDisplayName(steamDisplayName);
	}

	// Build update object
	const updateData: any = {
		steam_display_name: steamDisplayName,
		steam_verified_at: new Date().toISOString()
	};

	if (newDisplayName) {
		updateData.display_name = newDisplayName;
	}

	// Update profile
	const { error: updateError } = await supabaseAdmin
		.from('profiles')
		.update(updateData)
		.eq('id', userId);

	if (updateError) {
		console.error('[steam-persona] Failed to update profile:', updateError);
		throw new Error('Failed to update Steam profile data');
	}

	if (newDisplayName) {
		console.log('[steam-persona] Updated fallback display name to:', newDisplayName);
	}
}
