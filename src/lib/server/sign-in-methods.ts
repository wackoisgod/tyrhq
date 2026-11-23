import type { User } from '@supabase/supabase-js';
import { STEAM_PROVIDER } from './steam-oidc-provider';

export interface SignInMethodsResult {
	/**
	 * Number of distinct usable sign-in methods (1, 2, or 3)
	 */
	count: number;
	/**
	 * Whether user has Google OAuth as a sign-in method
	 */
	hasGoogle: boolean;
	/**
	 * Whether user has email+password as a sign-in method (real email + password set)
	 */
	hasEmailPassword: boolean;
	/**
	 * Whether user has verified Steam as a sign-in method
	 */
	hasSteam: boolean;
	/**
	 * Whether user can unlink Google (count >= 2 && hasGoogle)
	 */
	canUnlinkGoogle: boolean;
	/**
	 * Whether user can unlink Steam (count >= 2 && hasSteam)
	 */
	canUnlinkSteam: boolean;
	/**
	 * Whether user can remove email+password (count >= 2 && hasEmailPassword)
	 */
	canRemovePassword: boolean;
}

/**
 * Compute distinct usable sign-in methods for a user.
 * 
 * A user can sign in via:
 * 1. Google OAuth (has 'google' identity)
 * 2. Email+password (has real email + 'email' identity)
 * 3. Verified Steam (has verified_steam_id in profile)
 * 
 * This function counts these methods WITHOUT double-counting:
 * - Steam placeholder users (steam_*@users.tyrhq.invalid) do NOT have email+password method
 * - Google-only users (no password set) do NOT have email+password method
 * - Only when BOTH real email AND email identity exist does email+password count
 * 
 * @param user - Supabase auth user (contains identities and email)
 * @param verifiedSteamId - Steam ID from profiles table (verified_steam_id column)
 * @returns Object with method counts and unlink permissions
 */
export function computeSignInMethods(
	user: User | null,
	verifiedSteamId: string | null
): SignInMethodsResult {
	if (!user) {
		return {
			count: 0,
			hasGoogle: false,
			hasEmailPassword: false,
			hasSteam: false,
			canUnlinkGoogle: false,
			canUnlinkSteam: false,
			canRemovePassword: false
		};
	}

	const identities = user.identities || [];

	// Check each distinct sign-in method
	const hasGoogle = identities.some((i) => i.provider === 'google');

	// Email+password requires BOTH:
	// 1. Real email (not placeholder)
	// 2. Email identity (password is set)
	const hasRealEmail = user.email && !user.email.endsWith('@users.tyrhq.invalid');
	const hasEmailIdentity = identities.some((i) => i.provider === 'email');
	const hasEmailPassword = hasRealEmail && hasEmailIdentity;

	// Steam from identity (new OIDC provider) OR legacy verified_steam_id
	// Once migration is complete, this simplifies to just checking identities
	const hasSteamIdentity = identities.some((i) => i.provider === STEAM_PROVIDER);
	const hasSteam = hasSteamIdentity || !!verifiedSteamId;

	// Count distinct methods
	let count = 0;
	if (hasGoogle) count += 1;
	if (hasEmailPassword) count += 1;
	if (hasSteam) count += 1;

	// Can unlink/remove if at least 2 methods exist and user has that method
	const canUnlinkGoogle: boolean = count >= 2 && hasGoogle;
	const canUnlinkSteam: boolean = count >= 2 && hasSteam;
	const canRemovePassword: boolean = count >= 2 && hasEmailPassword;

	return {
		count,
		hasGoogle,
		hasEmailPassword,
		hasSteam,
		canUnlinkGoogle,
		canUnlinkSteam,
		canRemovePassword
	};
}
