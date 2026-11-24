/**
 * Tests for Steam Persona Management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isFallbackDisplayName, fetchSteamPersonaName, updateProfileWithPersona } from '$lib/server/steam-persona';

// Mock env
vi.mock('$env/dynamic/private', () => ({
	env: {
		STEAM_WEB_API_KEY: 'test-api-key'
	}
}));

// Mock supabase-admin
vi.mock('$lib/server/supabase-admin', () => ({
	getSupabaseAdminClient: vi.fn()
}));

describe('isFallbackDisplayName', () => {
	it('should return true for fallback pattern Player_######', () => {
		expect(isFallbackDisplayName('Player_123456')).toBe(true);
		expect(isFallbackDisplayName('Player_000000')).toBe(true);
		expect(isFallbackDisplayName('Player_999999')).toBe(true);
	});

	it('should return false for non-fallback names', () => {
		expect(isFallbackDisplayName('MyCustomName')).toBe(false);
		expect(isFallbackDisplayName('Player_12345')).toBe(false); // 5 digits
		expect(isFallbackDisplayName('Player_1234567')).toBe(false); // 7 digits
		expect(isFallbackDisplayName('Player_abc123')).toBe(false); // letters
		expect(isFallbackDisplayName('player_123456')).toBe(false); // lowercase
		expect(isFallbackDisplayName(null)).toBe(false);
		expect(isFallbackDisplayName(undefined)).toBe(false);
	});
});

describe('fetchSteamPersonaName', () => {
	let mockFetch: any;

	beforeEach(() => {
		mockFetch = vi.fn();
		global.fetch = mockFetch;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should fetch and return sanitized persona name', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				response: {
					players: [
						{ personaname: 'TestPlayer' }
					]
				}
			})
		});

		const name = await fetchSteamPersonaName('76561198012345678');
		expect(name).toBe('TestPlayer');
	});

	it('should return null when API returns empty players array', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				response: {
					players: []
				}
			})
		});

		const name = await fetchSteamPersonaName('76561198012345678');
		expect(name).toBe(null);
	});

	it('should return null when API returns non-OK status', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 403
		});

		const name = await fetchSteamPersonaName('76561198012345678');
		expect(name).toBe(null);
	});

	it('should sanitize persona name by trimming and removing control chars', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				response: {
					players: [
						{ personaname: '  Test\x00Player\x1F  ' }
					]
				}
			})
		});

		const name = await fetchSteamPersonaName('76561198012345678');
		expect(name).toBe('TestPlayer');
	});

	it('should cap persona name at 32 characters', async () => {
		const longName = 'A'.repeat(50);
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				response: {
					players: [
						{ personaname: longName }
					]
				}
			})
		});

		const name = await fetchSteamPersonaName('76561198012345678');
		expect(name).toBe('A'.repeat(32));
	});
});

describe('updateProfileWithPersona', () => {
	let mockSupabaseAdmin: any;

beforeEach(async () => {
	// Setup mock Supabase admin client with shared spies
	const eqSpy = vi.fn(() => Promise.resolve({ data: {}, error: null }));
	const updateSpy = vi.fn(() => ({ eq: eqSpy }));
	const selectSpy = vi.fn(() => ({
		ilike: vi.fn(() => ({
			limit: vi.fn(() => Promise.resolve({ data: [], error: null }))
		}))
	}));
	
	mockSupabaseAdmin = {
		from: vi.fn((table: string) => {
			if (table === 'profiles') {
				return {
					select: selectSpy,
					update: updateSpy
				};
			}
			return {};
		})
	};
	
	// Store the spies for assertions
	(mockSupabaseAdmin as any).updateSpy = updateSpy;
	(mockSupabaseAdmin as any).eqSpy = eqSpy;

	const { getSupabaseAdminClient } = await import('$lib/server/supabase-admin');
	vi.mocked(getSupabaseAdminClient).mockReturnValue(mockSupabaseAdmin);

		// Mock fetch for persona API
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				response: {
					players: [
						{ personaname: 'FreshPersona' }
					]
				}
			})
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should replace fallback display name with persona name', async () => {
		await updateProfileWithPersona('user-id', '76561198012345678', 'Player_123456');

		// Should update both display_name and steam_display_name
		expect(mockSupabaseAdmin.updateSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				display_name: 'FreshPersona',
				steam_display_name: 'FreshPersona'
			})
		);
	});

	it('should NOT replace user-chosen display name', async () => {
		await updateProfileWithPersona('user-id', '76561198012345678', 'MyCustomName');

		// Should only update steam_display_name, not display_name
		expect(mockSupabaseAdmin.updateSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				steam_display_name: 'FreshPersona'
			})
		);
		
		const updateCall = mockSupabaseAdmin.updateSpy.mock.calls[0][0];
		expect(updateCall).not.toHaveProperty('display_name');
	});

	it('should update steam_display_name even when persona fetch fails', async () => {
		// Mock failed fetch
		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500
		});

		await updateProfileWithPersona('user-id', '76561198012345678', 'Player_123456');

		// Should still update with null
		expect(mockSupabaseAdmin.updateSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				steam_display_name: null
			})
		);
	});
});
