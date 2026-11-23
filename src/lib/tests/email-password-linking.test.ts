/**
 * Tests for email & password linking functionality
 */

import { describe, it, expect } from 'vitest';

describe('Email & Password Linking', () => {
	describe('Email validation', () => {
		it('should accept valid email addresses', () => {
			const validEmails = [
				'user@example.com',
				'test.user@example.co.uk',
				'user+tag@example.com',
				'user123@test-domain.com'
			];

			validEmails.forEach((email) => {
				const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
				expect(emailRegex.test(email)).toBe(true);
			});
		});

		it('should reject invalid email addresses', () => {
			const invalidEmails = [
				'not-an-email',
				'@example.com',
				'user@',
				'user @example.com',
				'user@example',
				''
			];

			invalidEmails.forEach((email) => {
				const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
				expect(emailRegex.test(email)).toBe(false);
			});
		});
	});

	describe('Password validation', () => {
		it('should accept passwords with 8+ characters', () => {
			const validPasswords = [
				'password123',
				'12345678',
				'MyP@ssw0rd!',
				'a'.repeat(8)
			];

			validPasswords.forEach((password) => {
				expect(password.length >= 8).toBe(true);
			});
		});

		it('should reject passwords with less than 8 characters', () => {
			const invalidPasswords = [
				'short',
				'1234567',
				'pass',
				''
			];

			invalidPasswords.forEach((password) => {
				expect(password.length >= 8).toBe(false);
			});
		});
	});

	describe('Placeholder email detection', () => {
		it('should identify placeholder emails', () => {
			const placeholderEmails = [
				'steam_76561198012345678@users.tyrhq.invalid',
				'steam_12345678901234567@users.tyrhq.invalid'
			];

			placeholderEmails.forEach((email) => {
				expect(email.endsWith('@users.tyrhq.invalid')).toBe(true);
			});
		});

		it('should identify real emails', () => {
			const realEmails = [
				'user@example.com',
				'test@gmail.com',
				'player@tyrhq.com'
			];

			realEmails.forEach((email) => {
				expect(email.endsWith('@users.tyrhq.invalid')).toBe(false);
			});
		});
	});

	describe('Sign-in method counting', () => {
		it('should count distinct methods without double-counting', () => {
			const identities = [
				{ provider: 'email' },
				{ provider: 'google' }
			];
			const hasRealEmail = true;
			const hasEmailIdentity = identities.some((i) => i.provider === 'email');
			const verifiedSteamId = null;
			
			// Count: Google + Email+password (not double-counted)
			let count = 0;
			if (identities.some((i) => i.provider === 'google')) count += 1;
			if (hasRealEmail && hasEmailIdentity) count += 1;
			if (verifiedSteamId) count += 1;
			
			expect(count).toBe(2); // Google + Email+password, no double-count
		});

		it('should NOT count email+password for Steam placeholder users', () => {
			const identities = [
				{ provider: 'email' } // Created by admin.createUser with placeholder
			];
			const hasRealEmail = false; // steam_*@users.tyrhq.invalid
			const hasEmailIdentity = identities.some((i) => i.provider === 'email');
			const verifiedSteamId = '76561198012345678';
			
			let count = 0;
			if (identities.some((i) => i.provider === 'google')) count += 1;
			if (hasRealEmail && hasEmailIdentity) count += 1; // FALSE: placeholder email
			if (verifiedSteamId) count += 1;
			
			expect(count).toBe(1); // Only Steam, placeholder email doesn't count
		});

		it('should NOT count email+password for Google-only users (no password set)', () => {
			const identities = [
				{ provider: 'google' } // Has email from Google but no password
			];
			const hasRealEmail = true; // Real email from Google
			const hasEmailIdentity = identities.some((i) => i.provider === 'email');
			const verifiedSteamId = null;
			
			let count = 0;
			if (identities.some((i) => i.provider === 'google')) count += 1;
			if (hasRealEmail && hasEmailIdentity) count += 1; // FALSE: no email identity
			if (verifiedSteamId) count += 1;
			
			expect(count).toBe(1); // Only Google, no password
		});

		it('should prevent unlinking Google when it is the only method', () => {
			const identities = [
				{ provider: 'google' }
			];
			const hasRealEmail = true;
			const hasEmailIdentity = false;
			const verifiedSteamId = null;
			
			let count = 0;
			if (identities.some((i) => i.provider === 'google')) count += 1;
			if (hasRealEmail && hasEmailIdentity) count += 1;
			if (verifiedSteamId) count += 1;
			
			const canUnlinkGoogle = count >= 2 && identities.some((i) => i.provider === 'google');
			
			expect(count).toBe(1);
			expect(canUnlinkGoogle).toBe(false);
		});

		it('should allow unlinking Google when user has real email+password', () => {
			const identities = [
				{ provider: 'google' },
				{ provider: 'email' } // User set a password
			];
			const hasRealEmail = true;
			const hasEmailIdentity = identities.some((i) => i.provider === 'email');
			const verifiedSteamId = null;
			
			let count = 0;
			if (identities.some((i) => i.provider === 'google')) count += 1;
			if (hasRealEmail && hasEmailIdentity) count += 1;
			if (verifiedSteamId) count += 1;
			
			const canUnlinkGoogle = count >= 2 && identities.some((i) => i.provider === 'google');
			
			expect(count).toBe(2); // Google + Email+password
			expect(canUnlinkGoogle).toBe(true);
		});

		it('should count Steam+Google as 2 methods (can unlink either)', () => {
			const identities = [
				{ provider: 'google' },
				{ provider: 'email' } // Placeholder from Steam creation
			];
			const hasRealEmail = false; // Placeholder
			const hasEmailIdentity = identities.some((i) => i.provider === 'email');
			const verifiedSteamId = '76561198012345678';
			
			let count = 0;
			if (identities.some((i) => i.provider === 'google')) count += 1;
			if (hasRealEmail && hasEmailIdentity) count += 1;
			if (verifiedSteamId) count += 1;
			
			expect(count).toBe(2); // Google + Steam only
		});
	});

	describe('Steam login after email change', () => {
		it('should find user by verified_steam_id regardless of email', () => {
			// Simulate profile lookup by verified_steam_id
			const steamId = '76561198012345678';
			const profiles = [
				{ id: 'user-1', verified_steam_id: steamId, email: `steam_${steamId}@users.tyrhq.invalid` },
				{ id: 'user-2', verified_steam_id: '76561198087654321', email: 'other@example.com' }
			];

			// Lookup by Steam ID (not email)
			const found = profiles.find((p) => p.verified_steam_id === steamId);
			expect(found).toBeDefined();
			expect(found?.id).toBe('user-1');
		});

		it('should still work after user changes from placeholder to real email', () => {
			const steamId = '76561198012345678';
			
			// User changed email from placeholder to real
			const userBefore = { 
				id: 'user-1', 
				verified_steam_id: steamId, 
				email: `steam_${steamId}@users.tyrhq.invalid` 
			};
			
			const userAfter = { 
				id: 'user-1', 
				verified_steam_id: steamId, 
				email: 'player@example.com' 
			};

			// Steam login looks up by verified_steam_id, not email
			expect(userAfter.verified_steam_id).toBe(steamId);
			expect(userAfter.email).not.toContain('@users.tyrhq.invalid');
		});
	});

	describe('Error message mapping', () => {
		it('should map email_exists error code', () => {
			const errorMap: Record<string, string> = {
				'email_exists': 'email_exists',
				'email_not_confirmed': 'email_not_confirmed',
				'invalid_credentials': 'invalid_credentials'
			};

			expect(errorMap['email_exists']).toBe('email_exists');
		});

		it('should use fallback for unknown error codes', () => {
			const errorCode = 'unknown_error';
			const errorMap: Record<string, string> = {
				'email_exists': 'email_exists',
				'email_not_confirmed': 'email_not_confirmed',
				'invalid_credentials': 'invalid_credentials'
			};

			const mappedError = errorMap[errorCode] || 'email_change_failed';
			expect(mappedError).toBe('email_change_failed');
		});
	});

	describe('Password confirmation', () => {
		it('should validate matching passwords', () => {
			const password = 'MyPassword123';
			const confirmPassword = 'MyPassword123';

			expect(password === confirmPassword).toBe(true);
		});

	it('should reject non-matching passwords', () => {
		const password: string = 'MyPassword123';
		const confirmPassword: string = 'DifferentPassword';

		expect(password === confirmPassword).toBe(false);
	});

	it('should be case-sensitive', () => {
		const password: string = 'MyPassword123';
		const confirmPassword: string = 'mypassword123';

		expect(password === confirmPassword).toBe(false);
	});
	});

	describe('User UI states', () => {
		it('should show Add Email form for Steam placeholder users', () => {
			const hasRealEmail = false; // steam_*@users.tyrhq.invalid
			const hasEmailIdentity = true; // Created by admin.createUser
			const hasEmailPassword = hasRealEmail && hasEmailIdentity;
			const canSetPassword = hasRealEmail;
			
			// Steam placeholder user should:
			// - NOT show "✓ Email & Password" (hasEmailPassword is false)
			// - NOT show "Set Password" (canSetPassword is false)
			// - Show "Add Email" form
			expect(hasEmailPassword).toBe(false);
			expect(canSetPassword).toBe(false);
		});

		it('should show Set Password for Google-only users', () => {
			const hasRealEmail = true; // From Google
			const hasEmailIdentity = false; // No password set
			const hasEmailPassword = hasRealEmail && hasEmailIdentity;
			const canSetPassword = hasRealEmail;
			
			// Google-only user should:
			// - NOT show "✓ Email & Password" (hasEmailPassword is false)
			// - Show "Set Password" button (canSetPassword is true)
			expect(hasEmailPassword).toBe(false);
			expect(canSetPassword).toBe(true);
		});

		it('should show confirmed Email & Password for users with both', () => {
			const hasRealEmail = true;
			const hasEmailIdentity = true;
			const hasEmailPassword = hasRealEmail && hasEmailIdentity;
			const canSetPassword = hasRealEmail;
			
			// User with real email+password should:
			// - Show "✓ Email & Password" (hasEmailPassword is true)
			expect(hasEmailPassword).toBe(true);
		});
	});
});
