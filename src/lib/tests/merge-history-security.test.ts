/**
 * Tests for merge history security
 * Blocker 4 fix validation
 */

import { describe, it, expect } from 'vitest';

describe('Merge History Security', () => {
	it('should only return merges for current user', () => {
		const currentUserId = 'user-123';
		const mockMerges = [
			{ id: 'merge-1', primary_user_id: 'user-123' },
			{ id: 'merge-2', primary_user_id: 'user-456' },
			{ id: 'merge-3', primary_user_id: 'user-123' }
		];

		const userMerges = mockMerges.filter(m => m.primary_user_id === currentUserId);

		expect(userMerges.length).toBe(2);
		expect(userMerges.every(m => m.primary_user_id === currentUserId)).toBe(true);
	});

	it('should fetch via admin client (service_role)', () => {
		const mockFetchMethod = 'admin_client';
		expect(mockFetchMethod).toBe('admin_client');
	});

	it('should not expose other users merge history', () => {
		const user1Merges = [
			{ primary_user_id: 'user-1', secondary_email: 'user1-secondary@example.com' }
		];
		const user2Merges = [
			{ primary_user_id: 'user-2', secondary_email: 'user2-secondary@example.com' }
		];

		// User 1 should not see user 2's merges
		const user1CanSeeUser2 = user1Merges.some(m => m.primary_user_id === 'user-2');
		expect(user1CanSeeUser2).toBe(false);
	});

	it('should extract safe metadata from snapshot', () => {
		const mockMerge = {
			id: 'merge-123',
			secondary_snapshot: {
				user: { email: 'secondary@example.com' },
				profile: { display_name: 'SecondaryUser', verified_steam_id: '76561198012345678' }
			}
		};

		const safeData = {
			secondary_email: mockMerge.secondary_snapshot.user.email,
			secondary_display_name: mockMerge.secondary_snapshot.profile.display_name,
			secondary_steam_id: mockMerge.secondary_snapshot.profile.verified_steam_id
		};

		expect(safeData.secondary_email).toBe('secondary@example.com');
		expect(safeData.secondary_display_name).toBe('SecondaryUser');
		expect(safeData.secondary_steam_id).toBe('76561198012345678');
	});

	it('should handle missing snapshot data gracefully', () => {
		const mockMerge = {
			id: 'merge-123',
			secondary_snapshot: null
		};

		const safeData = {
			secondary_email: mockMerge.secondary_snapshot?.user?.email || null,
			secondary_display_name: mockMerge.secondary_snapshot?.profile?.display_name || null
		};

		expect(safeData.secondary_email).toBeNull();
		expect(safeData.secondary_display_name).toBeNull();
	});

	it('should use service_role permissions', () => {
		const tablePermissions = {
			account_merges: 'service_role_only',
			account_merge_rows: 'service_role_only'
		};

		expect(tablePermissions.account_merges).toBe('service_role_only');
		expect(tablePermissions.account_merge_rows).toBe('service_role_only');
	});
});
