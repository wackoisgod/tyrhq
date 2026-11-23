/**
 * Tests for account split functionality
 */

import { describe, it, expect, vi } from 'vitest';

// Mock environment variables
vi.mock('$env/dynamic/private', () => ({
	env: {
		MERGE_SECRET: 'a'.repeat(64)
	}
}));

import { createSplitCookie, verifySplitCookie } from '$lib/server/account-split';

describe('Account Split', () => {
	describe('Cookie creation and verification', () => {
		it('should create valid split cookie for Google with initiated phase', () => {
			const { value } = createSplitCookie('user-123', 'google', 'google-identity-456');

			expect(value).toBeTruthy();
			expect(value).toContain('.');

			const verified = verifySplitCookie(value);
			expect(verified).toBeTruthy();
			expect(verified?.currentUserId).toBe('user-123');
			expect(verified?.provider).toBe('google');
			expect(verified?.identityId).toBe('google-identity-456');
			expect(verified?.phase).toBe('initiated');
			expect(verified?.nonce.length).toBe(64);
		});

	it('should create valid split cookie for Steam', () => {
		const { value } = createSplitCookie('user-123', 'steam', 'steam-identity-456');

		const verified = verifySplitCookie(value);
		expect(verified).toBeTruthy();
		expect(verified?.provider).toBe('steam');
		expect(verified?.identityId).toBe('steam-identity-456');
	});

		it('should create valid split cookie for email', () => {
			const { value } = createSplitCookie('user-123', 'email', 'email-identity-789');

			const verified = verifySplitCookie(value);
			expect(verified).toBeTruthy();
			expect(verified?.provider).toBe('email');
			expect(verified?.identityId).toBe('email-identity-789');
		});

	it('should create authenticated phase cookie', () => {
		const { value } = createSplitCookie(
			'user-123',
			'google',
			'google-identity-456',
			'authenticated'
		);

		const verified = verifySplitCookie(value);
		expect(verified).toBeTruthy();
		expect(verified?.phase).toBe('authenticated');
	});

		it('should reject tampered cookie', () => {
			const { value } = createSplitCookie('user-123', 'google', 'identity-456');
			const [payloadB64, signature] = value.split('.');

			const payload = Buffer.from(payloadB64, 'base64').toString('utf8');
			const tampered = payload.replace('user-123', 'attacker-999');
			const tamperedB64 = Buffer.from(tampered).toString('base64');
			const tamperedValue = `${tamperedB64}.${signature}`;

			const verified = verifySplitCookie(tamperedValue);
			expect(verified).toBeNull();
		});

		it('should reject expired cookie', () => {
			const { value } = createSplitCookie('user-123', 'google', 'identity-456');
			const verified = verifySplitCookie(value);

			if (verified) {
				verified.expiresAt = Date.now() - 1000;
				const payload = JSON.stringify(verified);
				const fakeValue = `${Buffer.from(payload).toString('base64')}.fakesig`;

				const result = verifySplitCookie(fakeValue);
				expect(result).toBeNull();
			}
		});

		it('should reject cookie with missing fields', () => {
			const incomplete = {
				currentUserId: 'user-123',
				provider: 'google'
			};

			const payload = JSON.stringify(incomplete);
			const signature = 'fakesig';
			const cookieValue = `${Buffer.from(payload).toString('base64')}.${signature}`;

			const result = verifySplitCookie(cookieValue);
			expect(result).toBeNull();
		});

		it('should reject undefined cookie', () => {
			const result = verifySplitCookie(undefined);
			expect(result).toBeNull();
		});

		it('should reject empty cookie', () => {
			const result = verifySplitCookie('');
			expect(result).toBeNull();
		});

		it('should reject malformed cookie (no dot)', () => {
			const result = verifySplitCookie('malformed-cookie-no-signature');
			expect(result).toBeNull();
		});

		it('should reject cookie with invalid base64', () => {
			const result = verifySplitCookie('!!!invalid-base64!!!.fakesig');
			expect(result).toBeNull();
		});

		it('should have proper cookie options', () => {
			const { options } = createSplitCookie('user-123', 'google', 'identity-456');

			expect(options.httpOnly).toBe(true);
			expect(options.sameSite).toBe('lax');
			expect(options.path).toBe('/');
			expect(options.maxAge).toBe(600);
		});
	});
});
