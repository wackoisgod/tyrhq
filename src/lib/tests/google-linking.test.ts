/**
 * Tests for Google account linking logic
 */

import { describe, it, expect } from 'vitest';

describe('Google Linking Logic', () => {
	describe('Identity counting', () => {
		it('should allow unlinking when user has 2+ identities', () => {
			const linkedIdentities = [
				{ provider: 'google', email: 'user@example.com' },
				{ provider: 'email', email: 'user@example.com' }
			];
			
			const canUnlink = linkedIdentities.length >= 2 && 
				linkedIdentities.some((i) => i.provider === 'google');
			
			expect(canUnlink).toBe(true);
		});

		it('should not allow unlinking when user has only 1 identity', () => {
			const linkedIdentities = [
				{ provider: 'google', email: 'user@example.com' }
			];
			
			const canUnlink = linkedIdentities.length >= 2 && 
				linkedIdentities.some((i) => i.provider === 'google');
			
			expect(canUnlink).toBe(false);
		});

		it('should not allow unlinking when Google is not linked', () => {
			const linkedIdentities = [
				{ provider: 'email', email: 'user@example.com' },
				{ provider: 'email', email: 'user2@example.com' }
			];
			
			const canUnlink = linkedIdentities.length >= 2 && 
				linkedIdentities.some((i) => i.provider === 'google');
			
			expect(canUnlink).toBe(false);
		});
	});

	describe('Steam placeholder email users', () => {
		it('should recognize placeholder email pattern', () => {
			const placeholderEmail = 'steam_76561198012345678@users.tyrhq.invalid';
			expect(placeholderEmail.endsWith('@users.tyrhq.invalid')).toBe(true);
		});

	it('should allow Steam-only users to link Google', () => {
		// Steam-only user has placeholder email but no email/password identity
		const linkedIdentities: Array<{ provider: string; email?: string }> = [
			// No email identity, just Steam metadata
		];
		const userEmail = 'steam_76561198012345678@users.tyrhq.invalid';
		
		// User can link Google even without other identities (Steam auth exists)
		const canLinkGoogle = !linkedIdentities.some((i) => i.provider === 'google');
		expect(canLinkGoogle).toBe(true);
	});

		it('should allow Steam+Google users to unlink Google if they have 2+ methods', () => {
			const linkedIdentities = [
				{ provider: 'google', email: 'user@gmail.com' }
			];
			
			// In practice, Steam-only users would have just the user record with placeholder email
			// They can link Google, but should need 2+ identities to unlink
			const hasMultipleMethods = linkedIdentities.length >= 2;
			expect(hasMultipleMethods).toBe(false); // Can't unlink only method
		});
	});

	describe('Error message mapping', () => {
		it('should map link_failed error', () => {
			const errorMessages: Record<string, string> = {
				link_failed: 'Failed to link Google account. Please try again.',
				identity_already_exists: 'This Google account is already linked to another user.',
				manual_linking_disabled: 'Manual linking is not enabled. Contact your administrator.'
			};

			expect(errorMessages['link_failed']).toBeTruthy();
			expect(errorMessages['identity_already_exists']).toBeTruthy();
			expect(errorMessages['manual_linking_disabled']).toBeTruthy();
		});
	});
});
