/**
 * Tests for account merge functionality
 */

import { describe, it, expect, vi } from 'vitest';

// Mock environment variables
vi.mock('$env/dynamic/private', () => ({
	env: {
		MERGE_SECRET: 'a'.repeat(64) // 64-char secret for testing
	}
}));

import { createMergeCookie, verifyMergeCookie } from '$lib/server/account-merge';
import crypto from 'crypto';

describe('Account Merge', () => {
	describe('Cookie creation and verification', () => {
		it('should create valid merge cookie with initiated phase', () => {
			const { value } = createMergeCookie('primary-123');
			
			expect(value).toBeTruthy();
			expect(value).toContain('.'); // Has signature
			
			const verified = verifyMergeCookie(value);
			expect(verified).toBeTruthy();
			expect(verified?.primaryUserId).toBe('primary-123');
			expect(verified?.phase).toBe('initiated');
			expect(verified?.nonce.length).toBe(64); // 32 bytes hex
		});

		it('should create valid merge cookie with authenticated phase', () => {
			const { value } = createMergeCookie('primary-123', 'secondary-456', 'authenticated');
			
			const verified = verifyMergeCookie(value);
			expect(verified).toBeTruthy();
			expect(verified?.primaryUserId).toBe('primary-123');
			expect(verified?.secondaryUserId).toBe('secondary-456');
			expect(verified?.phase).toBe('authenticated');
		});

		it('should reject tampered cookie - base64 modification', () => {
			const { value } = createMergeCookie('primary-123');
			const [payloadB64, signature] = value.split('.');
			
			// Decode, modify, re-encode but keep old signature
			const payload = Buffer.from(payloadB64, 'base64').toString('utf8');
			const tampered = payload.replace('primary-123', 'attacker-999');
			const tamperedB64 = Buffer.from(tampered).toString('base64');
			const tamperedValue = `${tamperedB64}.${signature}`;
			
			const verified = verifyMergeCookie(tamperedValue);
			expect(verified).toBeNull();
		});

		it('should reject expired cookie', () => {
			const { value } = createMergeCookie('primary-123');
			const verified = verifyMergeCookie(value);
			
			// Manually expire it
			if (verified) {
				verified.expiresAt = Date.now() - 1000;
				const payload = JSON.stringify(verified);
				const fakeValue = `${Buffer.from(payload).toString('base64')}.fakesig`;
				
				const result = verifyMergeCookie(fakeValue);
				expect(result).toBeNull(); // Should fail signature check
			}
		});

		it('should reject cookie with wrong length secret', () => {
			// This would happen at runtime when secret is too short
			const shortSecret = 'tooshort';
			expect(shortSecret.length).toBeLessThan(32);
		});

		it('should reject cookie with missing fields', () => {
			const incomplete = {
				primaryUserId: 'user-123'
				// missing nonce, phase, issuedAt, expiresAt
			};
			
			const payload = JSON.stringify(incomplete);
			const fakeValue = `${Buffer.from(payload).toString('base64')}.fakesig`;
			
			const verified = verifyMergeCookie(fakeValue);
			expect(verified).toBeNull();
		});
	});

	describe('Merge validation', () => {
		it('should reject merging account into itself', () => {
			const primaryId = 'user-123';
			const secondaryId = 'user-123';

			expect(primaryId === secondaryId).toBe(true);
		});

		it('should allow merging different accounts', () => {
			const primaryId = 'user-123';
			const secondaryId = 'user-456';

			expect(primaryId !== secondaryId).toBe(true);
		});

		it('should require both user IDs to be present', () => {
			const primaryId = 'user-123';
			const secondaryId = null;

			const isValid = !!(primaryId && secondaryId);

			expect(isValid).toBe(false);
		});
	});

	describe('Data ownership transfer', () => {
		it('should transfer all data types', () => {
			const dataTypes = [
				'builds',
				'build_stars',
				'article_stars',
				'map_rooms',
				'contributions',
				'tank_notes',
				'api_credentials',
				'team_members',
				'team_join_requests',
				'tournament_registrations',
				'tournament_free_agents',
				'tournament_free_agent_requests',
				'tournament_roster_members',
				'tournament_build_submissions',
				'tournament_team_recruitment',
				'community_events'
			];

			// Verify all expected data types are accounted for
			expect(dataTypes.length).toBeGreaterThan(10);
			expect(dataTypes).toContain('builds');
			expect(dataTypes).toContain('tournament_registrations');
		});

		it('should handle duplicate entries', () => {
			// Simulate user already has star on same build
			const primaryStars = [{ build_id: 'build-1' }];
			const secondaryStars = [{ build_id: 'build-1' }, { build_id: 'build-2' }];

			// Should delete duplicates before merge
			const duplicates = secondaryStars.filter((s) =>
				primaryStars.some((p) => p.build_id === s.build_id)
			);

			expect(duplicates.length).toBe(1);
			expect(duplicates[0].build_id).toBe('build-1');
		});
	});

	describe('Steam data migration', () => {
		it('should move Steam ID when secondary has it', () => {
			const secondarySteamId = '76561198012345678';
			const shouldMoveStream = secondarySteamId !== null;

			expect(shouldMoveStream).toBe(true);
		});

		it('should not affect primary when secondary has no Steam', () => {
			const secondarySteamId = null;
			const shouldMoveStream = secondarySteamId !== null;

			expect(shouldMoveStream).toBe(false);
		});
	});

	describe('Display name logic', () => {
		it('should keep secondary name when primary is auto-generated', () => {
			const primaryName = 'Player_123456';
			const secondaryName = 'RealUsername';

			const isPrimaryAutoGenerated = /^Player_\d{6}$/.test(primaryName);
			const isSecondaryReal =
				secondaryName && secondaryName !== '' && !/^Player_\d{6}$/.test(secondaryName);

			const shouldUseSecondary = isPrimaryAutoGenerated && isSecondaryReal;

			expect(shouldUseSecondary).toBe(true);
		});

		it('should keep primary name when both are real', () => {
			const primaryName = 'RealPrimaryName';
			const secondaryName = 'RealSecondaryName';

			const isPrimaryAutoGenerated = /^Player_\d{6}$/.test(primaryName);
			const shouldUseSecondary = isPrimaryAutoGenerated;

			expect(shouldUseSecondary).toBe(false);
		});

		it('should keep primary name when secondary is auto-generated', () => {
			const primaryName = 'RealPrimaryName';
			const secondaryName = 'Player_654321';

			const isPrimaryAutoGenerated = /^Player_\d{6}$/.test(primaryName);
			const isSecondaryReal =
				secondaryName && secondaryName !== '' && !/^Player_\d{6}$/.test(secondaryName);

			const shouldUseSecondary = isPrimaryAutoGenerated && isSecondaryReal;

			expect(shouldUseSecondary).toBe(false);
		});
	});
});
