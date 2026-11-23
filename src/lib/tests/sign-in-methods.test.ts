/**
 * Tests for sign-in method computation and unlink guards
 */

import { describe, it, expect } from 'vitest';
import { computeSignInMethods } from '$lib/server/sign-in-methods';
import { STEAM_PROVIDER } from '$lib/server/steam-oidc-provider';
import type { User } from '@supabase/supabase-js';

describe('Sign-in Method Computation', () => {
	describe('Steam-only user', () => {
		it('should count 1 method: Steam only (OIDC identity)', () => {
			const user = {
				id: 'user-1b',
				email: 'steam_76561198012345678@users.tyrhq.invalid',
				identities: [{ provider: STEAM_PROVIDER, id: 'identity-steam' }]
			} as User;

			const result = computeSignInMethods(user);

			expect(result.count).toBe(1);
			expect(result.hasGoogle).toBe(false);
			expect(result.hasEmailPassword).toBe(false);
			expect(result.hasSteam).toBe(true);
			expect(result.canUnlinkSteam).toBe(false); // Cannot unlink: only method
		});

		it('should not count placeholder email+password', () => {
			const user = {
				id: 'user-1',
				email: 'steam_76561198012345678@users.tyrhq.invalid',
				identities: [{ provider: STEAM_PROVIDER, id: 'identity-steam' }]
			} as User;

			const result = computeSignInMethods(user);

			// Email identity exists but email is placeholder, so hasEmailPassword = false
			expect(result.hasEmailPassword).toBe(false);
		});
	});

	describe('Google-only user', () => {
		it('should count 1 method: Google only (no password)', () => {
			const user = {
				id: 'user-2',
				email: 'user@gmail.com',
				identities: [{ provider: 'google', id: 'identity-2' }]
			} as User;

			const result = computeSignInMethods(user);

			expect(result.count).toBe(1);
			expect(result.hasGoogle).toBe(true);
			expect(result.hasEmailPassword).toBe(false); // No email identity
			expect(result.hasSteam).toBe(false);
			expect(result.canUnlinkGoogle).toBe(false); // Cannot unlink: only method
		});

		it('should not count email+password when no password set', () => {
			const user = {
				id: 'user-2',
				email: 'user@gmail.com',
				identities: [{ provider: 'google', id: 'identity-2' }]
			} as User;

			const result = computeSignInMethods(user);

			// Real email but no email identity (no password), so hasEmailPassword = false
			expect(result.hasEmailPassword).toBe(false);
		});
	});

	describe('Steam + Google user', () => {
		it('should count 2 methods: Steam + Google (OIDC)', () => {
			const user = {
				id: 'user-3b',
				email: 'steam_76561198012345678@users.tyrhq.invalid',
				identities: [
					{ provider: STEAM_PROVIDER, id: 'identity-steam' },
					{ provider: 'google', id: 'identity-2' }
				]
			} as User;

			const result = computeSignInMethods(user);

			expect(result.count).toBe(2);
			expect(result.hasGoogle).toBe(true);
			expect(result.hasEmailPassword).toBe(false); // Placeholder email
			expect(result.hasSteam).toBe(true);
			expect(result.canUnlinkGoogle).toBe(true);
			expect(result.canUnlinkSteam).toBe(true);
		});
	});

	describe('Google + Email+password user', () => {
		it('should count 2 methods: Google + Email+password', () => {
			const user = {
				id: 'user-4',
				email: 'user@example.com',
				identities: [
					{ provider: 'google', id: 'identity-2' },
					{ provider: 'email', id: 'identity-1' }
				]
			} as User;

			const result = computeSignInMethods(user);

			expect(result.count).toBe(2);
			expect(result.hasGoogle).toBe(true);
			expect(result.hasEmailPassword).toBe(true); // Real email + email identity
			expect(result.hasSteam).toBe(false);
			expect(result.canUnlinkGoogle).toBe(true);
			expect(result.canRemovePassword).toBe(true);
		});

		it('should allow unlinking either method', () => {
			const user = {
				id: 'user-4',
				email: 'user@example.com',
				identities: [
					{ provider: 'google', id: 'identity-2' },
					{ provider: 'email', id: 'identity-1' }
				]
			} as User;

			const result = computeSignInMethods(user);

			expect(result.canUnlinkGoogle).toBe(true);
			expect(result.canRemovePassword).toBe(true);
		});
	});

	describe('All three methods', () => {
		it('should count 3 methods: Google + Email+password + Steam (OIDC)', () => {
			const user = {
				id: 'user-5b',
				email: 'user@example.com',
				identities: [
					{ provider: 'google', id: 'identity-2' },
					{ provider: 'email', id: 'identity-1' },
					{ provider: STEAM_PROVIDER, id: 'identity-steam' }
				]
			} as User;

			const result = computeSignInMethods(user);

			expect(result.count).toBe(3);
			expect(result.hasGoogle).toBe(true);
			expect(result.hasEmailPassword).toBe(true);
			expect(result.hasSteam).toBe(true);
			expect(result.canUnlinkGoogle).toBe(true);
			expect(result.canUnlinkSteam).toBe(true);
			expect(result.canRemovePassword).toBe(true);
		});
	});

	describe('Email+password only user', () => {
		it('should count 1 method: Email+password only', () => {
			const user = {
				id: 'user-6',
				email: 'user@example.com',
				identities: [{ provider: 'email', id: 'identity-1' }]
			} as User;

			const result = computeSignInMethods(user);

			expect(result.count).toBe(1);
			expect(result.hasGoogle).toBe(false);
			expect(result.hasEmailPassword).toBe(true);
			expect(result.hasSteam).toBe(false);
			expect(result.canRemovePassword).toBe(false); // Cannot remove: only method
		});
	});

	describe('Steam + Email+password user', () => {
		it('should count 2 methods: Steam + Email+password', () => {
			const user = {
				id: 'user-7',
				email: 'user@example.com',
				identities: [
					{ provider: 'email', id: 'identity-1' },
					{ provider: STEAM_PROVIDER, id: 'identity-steam' }
				]
			} as User;

			const result = computeSignInMethods(user);

			expect(result.count).toBe(2);
			expect(result.hasGoogle).toBe(false);
			expect(result.hasEmailPassword).toBe(true);
			expect(result.hasSteam).toBe(true);
			expect(result.canUnlinkSteam).toBe(true);
			expect(result.canRemovePassword).toBe(true);
		});
	});

	describe('Edge cases', () => {
		it('should handle null user', () => {
			const result = computeSignInMethods(null);

			expect(result.count).toBe(0);
			expect(result.hasGoogle).toBe(false);
			expect(result.hasEmailPassword).toBe(false);
			expect(result.hasSteam).toBe(false);
			expect(result.canUnlinkGoogle).toBe(false);
			expect(result.canUnlinkSteam).toBe(false);
			expect(result.canRemovePassword).toBe(false);
		});

	it('should handle user with no identities', () => {
		const user = {
			id: 'user-8',
			email: 'user@example.com',
			identities: [],
			app_metadata: {},
			user_metadata: {},
			aud: 'authenticated',
			created_at: new Date().toISOString()
		} as User;

		const result = computeSignInMethods(user);

		expect(result.count).toBe(0);
		expect(result.hasEmailPassword).toBe(false); // No email identity
	});

		it('should handle Steam verification after email change', () => {
			// User changed from placeholder to real email but still has Steam
			const user = {
				id: 'user-9',
				email: 'player@example.com', // Changed from steam_*@users.tyrhq.invalid
				identities: [
					{ provider: 'email', id: 'identity-1' },
					{ provider: STEAM_PROVIDER, id: 'identity-steam' }
				]
			} as User;

			const result = computeSignInMethods(user);

			// Should count both Steam and Email+password now
			expect(result.count).toBe(2);
			expect(result.hasEmailPassword).toBe(true);
			expect(result.hasSteam).toBe(true);
		});
	});

	describe('Guard enforcement', () => {
		it('should prevent unlinking when only 1 method', () => {
			const steamOnly = {
				id: 'user-1',
				email: 'steam_76561198012345678@users.tyrhq.invalid',
				identities: [{ provider: STEAM_PROVIDER, id: 'identity-steam' }]
			} as User;

			const result = computeSignInMethods(steamOnly);
			expect(result.canUnlinkSteam).toBe(false);
		});

		it('should allow unlinking when 2+ methods', () => {
			const steamAndGoogle = {
				id: 'user-3',
				email: 'steam_76561198012345678@users.tyrhq.invalid',
				identities: [
					{ provider: STEAM_PROVIDER, id: 'identity-steam' },
					{ provider: 'google', id: 'identity-2' }
				]
			} as User;

			const result = computeSignInMethods(steamAndGoogle);
			expect(result.canUnlinkSteam).toBe(true);
			expect(result.canUnlinkGoogle).toBe(true);
		});

		it('should not allow removing method user does not have', () => {
			const googleOnly = {
				id: 'user-2',
				email: 'user@gmail.com',
				identities: [{ provider: 'google', id: 'identity-2' }]
			} as User;

			const result = computeSignInMethods(googleOnly);
			expect(result.canRemovePassword).toBe(false); // No password to remove
			expect(result.canUnlinkSteam).toBe(false); // No Steam to unlink
		});
	});
});
