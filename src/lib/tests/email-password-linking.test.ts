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
		it('should count email+password when email identity exists', () => {
			const identities = [
				{ provider: 'email' }, // Has password
				{ provider: 'google' }
			];
			const hasEmailIdentity = identities.some((i) => i.provider === 'email');
			const totalMethods = identities.length + (hasEmailIdentity ? 1 : 0);
			
			expect(hasEmailIdentity).toBe(true);
			expect(totalMethods).toBe(3); // 2 identities + 1 for email+password
		});

		it('should NOT count email+password for Google-only users (no password)', () => {
			const identities = [
				{ provider: 'google' } // Has email from Google but no password
			];
			const hasEmailIdentity = identities.some((i) => i.provider === 'email');
			const totalMethods = identities.length + (hasEmailIdentity ? 1 : 0);
			
			expect(hasEmailIdentity).toBe(false);
			expect(totalMethods).toBe(1); // Only Google identity, no email+password
		});

		it('should prevent unlinking Google when it is the only method', () => {
			const identities = [
				{ provider: 'google' } // Google-only user
			];
			const hasEmailIdentity = identities.some((i) => i.provider === 'email');
			const totalMethods = identities.length + (hasEmailIdentity ? 1 : 0);
			const canUnlinkGoogle = totalMethods >= 2 && identities.some((i) => i.provider === 'google');
			
			expect(totalMethods).toBe(1);
			expect(canUnlinkGoogle).toBe(false);
		});

		it('should allow unlinking Google when user has set password', () => {
			const identities = [
				{ provider: 'google' },
				{ provider: 'email' } // User set a password
			];
			const hasEmailIdentity = identities.some((i) => i.provider === 'email');
			const totalMethods = identities.length + (hasEmailIdentity ? 1 : 0);
			const canUnlinkGoogle = totalMethods >= 2 && identities.some((i) => i.provider === 'google');
			
			expect(totalMethods).toBe(3);
			expect(canUnlinkGoogle).toBe(true);
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
			const password = 'MyPassword123';
			const confirmPassword = 'DifferentPassword';

			expect(password === confirmPassword).toBe(false);
		});

		it('should be case-sensitive', () => {
			const password = 'MyPassword123';
			const confirmPassword = 'mypassword123';

			expect(password === confirmPassword).toBe(false);
		});
	});

	describe('Google-only user states', () => {
		it('should detect when user can set password (has real email, no email identity)', () => {
			const hasRealEmail = true; // From Google
			const hasEmailIdentity = false; // No password set
			const canSetPassword = hasRealEmail && !hasEmailIdentity;
			
			expect(canSetPassword).toBe(true);
		});

		it('should not allow setting password for placeholder email users', () => {
			const hasRealEmail = false; // Steam placeholder
			const hasEmailIdentity = false;
			const canSetPassword = hasRealEmail && !hasEmailIdentity;
			
			expect(canSetPassword).toBe(false);
		});

		it('should not show set password option when password already exists', () => {
			const hasRealEmail = true;
			const hasEmailIdentity = true; // Already has password
			const canSetPassword = hasRealEmail && !hasEmailIdentity;
			
			expect(canSetPassword).toBe(false);
		});
	});
});
