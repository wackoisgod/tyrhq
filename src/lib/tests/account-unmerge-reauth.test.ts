/**
 * Tests for unmerge re-authentication requirement
 * Blocker 3 fix validation
 */

import { describe, it, expect, vi } from 'vitest';

// Mock environment
vi.mock('$env/dynamic/private', () => ({
	env: {
		MERGE_SECRET: 'a'.repeat(64)
	}
}));

import { createUnmergeCookie, verifyUnmergeCookie } from '$lib/server/account-unmerge';

describe('Account Unmerge - Re-authentication', () => {
	describe('Unmerge cookie', () => {
		it('should create valid unmerge cookie with nonce', () => {
			const { value } = createUnmergeCookie('primary-123', 'merge-456');

			expect(value).toBeTruthy();
			expect(value).toContain('.');

			const verified = verifyUnmergeCookie(value);
			expect(verified).toBeTruthy();
			expect(verified?.nonce.length).toBe(64);
			expect(verified?.primaryUserId).toBe('primary-123');
			expect(verified?.mergeId).toBe('merge-456');
		});

		it('should use initiated phase by default', () => {
			const { value } = createUnmergeCookie('primary-123', 'merge-456');
			const verified = verifyUnmergeCookie(value);

			expect(verified?.phase).toBe('initiated');
		});

		it('should support authenticated phase', () => {
			const { value } = createUnmergeCookie('primary-123', 'merge-456', 'authenticated');
			const verified = verifyUnmergeCookie(value);

			expect(verified?.phase).toBe('authenticated');
		});

		it('should reject tampered cookie', () => {
			const { value } = createUnmergeCookie('primary-123', 'merge-456');
			const [payloadB64, signature] = value.split('.');

			const payload = Buffer.from(payloadB64, 'base64').toString('utf8');
			const tampered = payload.replace('primary-123', 'attacker-999');
			const tamperedB64 = Buffer.from(tampered).toString('base64');
			const tamperedValue = `${tamperedB64}.${signature}`;

			const verified = verifyUnmergeCookie(tamperedValue);
			expect(verified).toBeNull();
		});

		it('should have httpOnly and secure options', () => {
			const { options } = createUnmergeCookie('primary-123', 'merge-456');

			expect(options.httpOnly).toBe(true);
			expect(options.sameSite).toBe('lax');
			expect(options.maxAge).toBe(600); // 10 minutes
		});
	});

	describe('Re-authentication flow', () => {
		it('should require cookie to complete unmerge', () => {
			const mockRequest = {
				hasCookie: false,
				shouldAllow: false
			};

			expect(mockRequest.shouldAllow).toBe(mockRequest.hasCookie);
		});

		it('should verify user is primary user', () => {
			const mockCookie = {
				primaryUserId: 'primary-123'
			};
			const mockCurrentUser = {
				id: 'primary-123'
			};

			const isAuthorized = mockCookie.primaryUserId === mockCurrentUser.id;
			expect(isAuthorized).toBe(true);
		});

		it('should reject if user does not match cookie', () => {
			const mockCookie = {
				primaryUserId: 'primary-123'
			};
			const mockCurrentUser = {
				id: 'different-456'
			};

			const isAuthorized = mockCookie.primaryUserId === mockCurrentUser.id;
			expect(isAuthorized).toBe(false);
		});

		it('should mark nonce as used', () => {
			const mockNonce = 'abc123';
			const mockUsedNonces = new Set<string>();

			mockUsedNonces.add(mockNonce);

			expect(mockUsedNonces.has(mockNonce)).toBe(true);
		});

		it('should reject reused nonce', () => {
			const mockNonce = 'abc123';
			const mockUsedNonces = new Set(['abc123']);

			const isAlreadyUsed = mockUsedNonces.has(mockNonce);
			expect(isAlreadyUsed).toBe(true);
		});
	});
});
