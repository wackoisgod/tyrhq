/**
 * Tests for Steam login callback
 *
 * Covers:
 * - Valid authentication flow (new user)
 * - Valid authentication flow (returning user)
 * - Invalid signature
 * - Mismatched return_to
 * - Nonce mismatch
 * - Missing nonce
 * - Concurrent race condition
 * - Stuck-account recovery path
 * - Open-redirect next parameter protection
 * - Display name deduplication with wildcard characters
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from './+server';
import type { RequestEvent } from '@sveltejs/kit';

// Mock dependencies
vi.mock('$lib/server/supabase-admin', () => ({
	getSupabaseAdminClient: vi.fn()
}));

describe('Steam Login Callback', () => {
	let mockEvent: Partial<RequestEvent>;
	let mockSupabaseAdmin: any;
	let mockFetch: any;

	beforeEach(() => {
		// Setup mock Supabase admin client
		mockSupabaseAdmin = {
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					eq: vi.fn(() => ({
						maybeSingle: vi.fn()
					})),
					ilike: vi.fn(() => ({
						maybeSingle: vi.fn()
					}))
				})),
				update: vi.fn(() => ({
					eq: vi.fn()
				}))
			})),
			auth: {
				admin: {
					createUser: vi.fn(),
					getUserById: vi.fn(),
					generateLink: vi.fn()
				}
			}
		};

		const { getSupabaseAdminClient } = await import('$lib/server/supabase-admin');
		vi.mocked(getSupabaseAdminClient).mockReturnValue(mockSupabaseAdmin);

		// Mock global fetch for Steam verification
		mockFetch = vi.fn();
		global.fetch = mockFetch;

		// Setup mock request event
		mockEvent = {
			url: new URL('http://localhost:5173/auth/steam/login/callback'),
			cookies: {
				get: vi.fn(),
				delete: vi.fn()
			},
			locals: {
				supabase: {
					auth: {
						verifyOtp: vi.fn()
					}
				}
			}
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should create a new user when Steam ID is not linked', async () => {
		// Setup valid OpenID response
		const testNonce = 'test-nonce-12345';
		const state = JSON.stringify({ mode: 'login', next: '/', nonce: testNonce });
		vi.mocked(mockEvent.cookies!.get).mockReturnValue(state);

		mockEvent.url = new URL(
			'http://localhost:5173/auth/steam/login/callback' +
				'?state=' + testNonce +
				'&openid.ns=http://specs.openid.net/auth/2.0' +
				'&openid.mode=id_res' +
				'&openid.op_endpoint=https://steamcommunity.com/openid/login' +
				'&openid.return_to=http://localhost:5173/auth/steam/login/callback?state=' + testNonce +
				'&openid.claimed_id=https://steamcommunity.com/openid/id/76561198012345678' +
				'&openid.identity=https://steamcommunity.com/openid/id/76561198012345678'
		);

		// Mock Steam verification (valid)
		mockFetch.mockResolvedValueOnce({
			ok: true,
			text: async () => 'is_valid:true\n'
		});

		// Mock no existing profile
		mockSupabaseAdmin.from().select().eq().maybeSingle.mockResolvedValueOnce({
			data: null,
			error: null
		});

		// Mock user creation
		mockSupabaseAdmin.auth.admin.createUser.mockResolvedValueOnce({
			data: { user: { id: 'new-user-id' } },
			error: null
		});

		// Mock display name deduplication
		mockSupabaseAdmin.from().select().ilike = vi.fn(() => ({
			limit: vi.fn(() => ({
				then: vi.fn((cb) => cb({ data: [], error: null }))
			}))
		}));

		// Mock profile upsert
		mockSupabaseAdmin.from().upsert = vi.fn(() => ({
			then: vi.fn((cb) => cb({ data: {}, error: null, count: 1 }))
		}));

		// Mock auth user lookup
		mockSupabaseAdmin.auth.admin.getUserById.mockResolvedValueOnce({
			data: { user: { id: 'new-user-id', email: 'steam_76561198012345678@users.tyrhq.invalid' } },
			error: null
		});

		// Mock generate link
		mockSupabaseAdmin.auth.admin.generateLink.mockResolvedValueOnce({
			data: { properties: { hashed_token: 'hashed-token' } },
			error: null
		});

		// Mock verify OTP
		vi.mocked(mockEvent.locals!.supabase.auth.verifyOtp).mockResolvedValueOnce({
			data: { user: {}, session: {} },
			error: null
		});

		await expect(GET(mockEvent as RequestEvent)).rejects.toThrow();
		expect(mockSupabaseAdmin.auth.admin.createUser).toHaveBeenCalledWith(
			expect.objectContaining({
				email: 'steam_76561198012345678@users.tyrhq.invalid',
				email_confirm: true,
				user_metadata: {
					provider: 'steam',
					steam_id: '76561198012345678'
				}
			})
		);
	});

	it('should sign in existing user when Steam ID is already linked', async () => {
		const testNonce = 'test-nonce-existing';
		const state = JSON.stringify({ mode: 'login', next: '/', nonce: testNonce });
		vi.mocked(mockEvent.cookies!.get).mockReturnValue(state);

		mockEvent.url = new URL(
			'http://localhost:5173/auth/steam/login/callback' +
				'?state=' + testNonce +
				'&openid.ns=http://specs.openid.net/auth/2.0' +
				'&openid.mode=id_res' +
				'&openid.op_endpoint=https://steamcommunity.com/openid/login' +
				'&openid.return_to=http://localhost:5173/auth/steam/login/callback?state=' + testNonce +
				'&openid.claimed_id=https://steamcommunity.com/openid/id/76561198012345678' +
				'&openid.identity=https://steamcommunity.com/openid/id/76561198012345678'
		);

		mockFetch.mockResolvedValueOnce({
			ok: true,
			text: async () => 'is_valid:true\n'
		});

		// Mock existing profile
		mockSupabaseAdmin.from().select().eq().maybeSingle.mockResolvedValueOnce({
			data: { id: 'existing-user-id', display_name: 'ExistingPlayer' },
			error: null
		});

		mockSupabaseAdmin.auth.admin.getUserById.mockResolvedValueOnce({
			data: { user: { id: 'existing-user-id', email: 'player@example.com' } },
			error: null
		});

		mockSupabaseAdmin.auth.admin.generateLink.mockResolvedValueOnce({
			data: { properties: { hashed_token: 'hashed-token' } },
			error: null
		});

		vi.mocked(mockEvent.locals!.supabase.auth.verifyOtp).mockResolvedValueOnce({
			data: { user: {}, session: {} },
			error: null
		});

		await expect(GET(mockEvent as RequestEvent)).rejects.toThrow();
		expect(mockSupabaseAdmin.auth.admin.createUser).not.toHaveBeenCalled();
	});

	it('should reject invalid Steam signature', async () => {
		const testNonce = 'test-nonce-invalid';
		const state = JSON.stringify({ mode: 'login', next: '/', nonce: testNonce });
		vi.mocked(mockEvent.cookies!.get).mockReturnValue(state);

		mockEvent.url = new URL(
			'http://localhost:5173/auth/steam/login/callback' +
				'?state=' + testNonce +
				'&openid.ns=http://specs.openid.net/auth/2.0' +
				'&openid.mode=id_res' +
				'&openid.op_endpoint=https://steamcommunity.com/openid/login' +
				'&openid.return_to=http://localhost:5173/auth/steam/login/callback?state=' + testNonce +
				'&openid.claimed_id=https://steamcommunity.com/openid/id/76561198012345678' +
				'&openid.identity=https://steamcommunity.com/openid/id/76561198012345678'
		);

		// Mock Steam verification (invalid)
		mockFetch.mockResolvedValueOnce({
			ok: true,
			text: async () => 'is_valid:false\n'
		});

		await expect(GET(mockEvent as RequestEvent)).rejects.toThrow(
			'Steam signature verification failed'
		);
	});

	it('should reject mismatched return_to', async () => {
		const testNonce = 'test-nonce-mismatch';
		const state = JSON.stringify({ mode: 'login', next: '/', nonce: testNonce });
		vi.mocked(mockEvent.cookies!.get).mockReturnValue(state);

		mockEvent.url = new URL(
			'http://localhost:5173/auth/steam/login/callback' +
				'?state=' + testNonce +
				'&openid.ns=http://specs.openid.net/auth/2.0' +
				'&openid.mode=id_res' +
				'&openid.op_endpoint=https://steamcommunity.com/openid/login' +
				'&openid.return_to=http://evil.com/callback' +
				'&openid.claimed_id=https://steamcommunity.com/openid/id/76561198012345678' +
				'&openid.identity=https://steamcommunity.com/openid/id/76561198012345678'
		);

		await expect(GET(mockEvent as RequestEvent)).rejects.toThrow('Invalid return URL');
	});

	it('should handle concurrent race condition when creating users', async () => {
		const testNonce = 'test-nonce-race';
		const state = JSON.stringify({ mode: 'login', next: '/', nonce: testNonce });
		vi.mocked(mockEvent.cookies!.get).mockReturnValue(state);

		mockEvent.url = new URL(
			'http://localhost:5173/auth/steam/login/callback' +
				'?state=' + testNonce +
				'&openid.ns=http://specs.openid.net/auth/2.0' +
				'&openid.mode=id_res' +
				'&openid.op_endpoint=https://steamcommunity.com/openid/login' +
				'&openid.return_to=http://localhost:5173/auth/steam/login/callback?state=' + testNonce +
				'&openid.claimed_id=https://steamcommunity.com/openid/id/76561198012345678' +
				'&openid.identity=https://steamcommunity.com/openid/id/76561198012345678'
		);

		mockFetch.mockResolvedValueOnce({
			ok: true,
			text: async () => 'is_valid:true\n'
		});

		// First lookup: no profile
		mockSupabaseAdmin.from().select().eq().maybeSingle.mockResolvedValueOnce({
			data: null,
			error: null
		});

		// Create user fails (race condition - user already exists)
		mockSupabaseAdmin.auth.admin.createUser.mockResolvedValueOnce({
			data: null,
			error: { message: 'User already exists', code: '23505' }
		});

		// Retry lookup: profile now exists
		mockSupabaseAdmin.from().select().eq().maybeSingle.mockResolvedValueOnce({
			data: { id: 'concurrent-user-id', display_name: 'ConcurrentPlayer' },
			error: null
		});

		mockSupabaseAdmin.auth.admin.getUserById.mockResolvedValueOnce({
			data: { user: { id: 'concurrent-user-id', email: 'steam_76561198012345678@users.tyrhq.invalid' } },
			error: null
		});

		mockSupabaseAdmin.auth.admin.generateLink.mockResolvedValueOnce({
			data: { properties: { hashed_token: 'hashed-token' } },
			error: null
		});

		vi.mocked(mockEvent.locals!.supabase.auth.verifyOtp).mockResolvedValueOnce({
			data: { user: {}, session: {} },
			error: null
		});

		await expect(GET(mockEvent as RequestEvent)).rejects.toThrow();
		// Should have attempted retry
		expect(mockSupabaseAdmin.from().select).toHaveBeenCalledTimes(2);
	});

	it('should sanitize next parameter to prevent open redirects', async () => {
		const testNonce = 'test-nonce-redirect';
		const state = JSON.stringify({
			mode: 'login',
			next: '//evil.com/phishing',
			nonce: testNonce
		});
		vi.mocked(mockEvent.cookies!.get).mockReturnValue(state);

		mockEvent.url = new URL(
			'http://localhost:5173/auth/steam/login/callback' +
				'?state=' + testNonce +
				'&openid.ns=http://specs.openid.net/auth/2.0' +
				'&openid.mode=id_res' +
				'&openid.op_endpoint=https://steamcommunity.com/openid/login' +
				'&openid.return_to=http://localhost:5173/auth/steam/login/callback?state=' + testNonce +
				'&openid.claimed_id=https://steamcommunity.com/openid/id/76561198012345678' +
				'&openid.identity=https://steamcommunity.com/openid/id/76561198012345678'
		);

		mockFetch.mockResolvedValueOnce({
			ok: true,
			text: async () => 'is_valid:true\n'
		});

		mockSupabaseAdmin.from().select().eq().maybeSingle.mockResolvedValueOnce({
			data: { id: 'user-id', display_name: 'Player' },
			error: null
		});

		mockSupabaseAdmin.auth.admin.getUserById.mockResolvedValueOnce({
			data: { user: { id: 'user-id', email: 'player@example.com' } },
			error: null
		});

		mockSupabaseAdmin.auth.admin.generateLink.mockResolvedValueOnce({
			data: { properties: { hashed_token: 'hashed-token' } },
			error: null
		});

		vi.mocked(mockEvent.locals!.supabase.auth.verifyOtp).mockResolvedValueOnce({
			data: { user: {}, session: {} },
			error: null
		});

		try {
			await GET(mockEvent as RequestEvent);
		} catch (err: any) {
			// Should redirect to safe path, not to //evil.com
			expect(err.location).not.toContain('evil.com');
			expect(err.location).toBe('/');
		}
	});

	it('should reject mismatched nonce', async () => {
		const state = JSON.stringify({ mode: 'login', next: '/', nonce: 'correct-nonce' });
		vi.mocked(mockEvent.cookies!.get).mockReturnValue(state);

		mockEvent.url = new URL(
			'http://localhost:5173/auth/steam/login/callback' +
				'?state=wrong-nonce' +
				'&openid.ns=http://specs.openid.net/auth/2.0' +
				'&openid.mode=id_res' +
				'&openid.op_endpoint=https://steamcommunity.com/openid/login' +
				'&openid.return_to=http://localhost:5173/auth/steam/login/callback?state=wrong-nonce' +
				'&openid.claimed_id=https://steamcommunity.com/openid/id/76561198012345678' +
				'&openid.identity=https://steamcommunity.com/openid/id/76561198012345678'
		);

		await expect(GET(mockEvent as RequestEvent)).rejects.toThrow(
			'Invalid state nonce'
		);
	});

	it('should reject missing nonce parameter', async () => {
		const state = JSON.stringify({ mode: 'login', next: '/', nonce: 'test-nonce' });
		vi.mocked(mockEvent.cookies!.get).mockReturnValue(state);

		mockEvent.url = new URL(
			'http://localhost:5173/auth/steam/login/callback' +
				'?openid.ns=http://specs.openid.net/auth/2.0' +
				'&openid.mode=id_res' +
				'&openid.op_endpoint=https://steamcommunity.com/openid/login' +
				'&openid.return_to=http://localhost:5173/auth/steam/login/callback' +
				'&openid.claimed_id=https://steamcommunity.com/openid/id/76561198012345678' +
				'&openid.identity=https://steamcommunity.com/openid/id/76561198012345678'
		);

		await expect(GET(mockEvent as RequestEvent)).rejects.toThrow(
			'Missing state parameter'
		);
	});

	it('should recover from stuck-account bug', async () => {
		const testNonce = 'test-nonce-stuck';
		const state = JSON.stringify({ mode: 'login', next: '/', nonce: testNonce });
		vi.mocked(mockEvent.cookies!.get).mockReturnValue(state);

		mockEvent.url = new URL(
			'http://localhost:5173/auth/steam/login/callback' +
				'?state=' + testNonce +
				'&openid.ns=http://specs.openid.net/auth/2.0' +
				'&openid.mode=id_res' +
				'&openid.op_endpoint=https://steamcommunity.com/openid/login' +
				'&openid.return_to=http://localhost:5173/auth/steam/login/callback?state=' + testNonce +
				'&openid.claimed_id=https://steamcommunity.com/openid/id/76561198012345678' +
				'&openid.identity=https://steamcommunity.com/openid/id/76561198012345678'
		);

		mockFetch.mockResolvedValueOnce({
			ok: true,
			text: async () => 'is_valid:true\n'
		});

		// First lookup: no profile
		mockSupabaseAdmin.from().select().eq().maybeSingle.mockResolvedValueOnce({
			data: null,
			error: null
		});

		// Create user fails (already exists)
		mockSupabaseAdmin.auth.admin.createUser.mockResolvedValueOnce({
			data: null,
			error: { message: 'User already registered', status: 422 }
		});

		// List users finds the existing user
		mockSupabaseAdmin.auth.admin.listUsers.mockResolvedValueOnce({
			data: {
				users: [
					{
						id: 'stuck-user-id',
						email: 'steam_76561198012345678@users.tyrhq.invalid'
					}
				]
			},
			error: null
		});

		// Retry lookup still finds no profile (stuck account scenario)
		mockSupabaseAdmin.from().select().eq().maybeSingle.mockResolvedValueOnce({
			data: null,
			error: null
		});

		// Mock display name check
		mockSupabaseAdmin.from().select().ilike = vi.fn(() => ({
			limit: vi.fn(() => Promise.resolve({ data: [], error: null }))
		}));

		// Upsert should complete initialization
		mockSupabaseAdmin.from().upsert = vi.fn(() =>
			Promise.resolve({ data: {}, error: null, count: 1 })
		);

		mockSupabaseAdmin.auth.admin.getUserById.mockResolvedValueOnce({
			data: {
				user: { id: 'stuck-user-id', email: 'steam_76561198012345678@users.tyrhq.invalid' }
			},
			error: null
		});

		mockSupabaseAdmin.auth.admin.generateLink.mockResolvedValueOnce({
			data: { properties: { hashed_token: 'hashed-token' } },
			error: null
		});

		vi.mocked(mockEvent.locals!.supabase.auth.verifyOtp).mockResolvedValueOnce({
			data: { user: {}, session: {} },
			error: null
		});

		await expect(GET(mockEvent as RequestEvent)).rejects.toThrow();
		// Should have called upsert to complete initialization
		expect(mockSupabaseAdmin.from().upsert).toHaveBeenCalled();
	});

	it('should handle display name deduplication with wildcard characters', async () => {
		const testNonce = 'test-nonce-wildcard';
		const state = JSON.stringify({ mode: 'login', next: '/', nonce: testNonce });
		vi.mocked(mockEvent.cookies!.get).mockReturnValue(state);

		mockEvent.url = new URL(
			'http://localhost:5173/auth/steam/login/callback' +
				'?state=' + testNonce +
				'&openid.ns=http://specs.openid.net/auth/2.0' +
				'&openid.mode=id_res' +
				'&openid.op_endpoint=https://steamcommunity.com/openid/login' +
				'&openid.return_to=http://localhost:5173/auth/steam/login/callback?state=' + testNonce +
				'&openid.claimed_id=https://steamcommunity.com/openid/id/76561198012345678' +
				'&openid.identity=https://steamcommunity.com/openid/id/76561198012345678'
		);

		mockFetch.mockResolvedValueOnce({
			ok: true,
			text: async () => 'is_valid:true\n'
		});

		// Mock Steam API response with wildcard characters in name
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				response: {
					players: [{ personaname: 'Player_%_Name' }]
				}
			})
		});

		mockSupabaseAdmin.from().select().eq().maybeSingle.mockResolvedValueOnce({
			data: null,
			error: null
		});

		mockSupabaseAdmin.auth.admin.createUser.mockResolvedValueOnce({
			data: { user: { id: 'new-user-id' } },
			error: null
		});

		// Mock display name check - should escape wildcards
		let ilikeCallCount = 0;
		mockSupabaseAdmin.from().select().ilike = vi.fn((column, pattern) => {
			ilikeCallCount++;
			// First call should have escaped pattern
			if (ilikeCallCount === 1) {
				expect(pattern).toContain('\\%');
				expect(pattern).toContain('\\_');
			}
			return {
				limit: vi.fn(() => Promise.resolve({ data: [], error: null }))
			};
		});

		mockSupabaseAdmin.from().upsert = vi.fn(() =>
			Promise.resolve({ data: {}, error: null, count: 1 })
		);

		mockSupabaseAdmin.auth.admin.getUserById.mockResolvedValueOnce({
			data: { user: { id: 'new-user-id', email: 'steam_76561198012345678@users.tyrhq.invalid' } },
			error: null
		});

		mockSupabaseAdmin.auth.admin.generateLink.mockResolvedValueOnce({
			data: { properties: { hashed_token: 'hashed-token' } },
			error: null
		});

		vi.mocked(mockEvent.locals!.supabase.auth.verifyOtp).mockResolvedValueOnce({
			data: { user: {}, session: {} },
			error: null
		});

		await expect(GET(mockEvent as RequestEvent)).rejects.toThrow();
		expect(ilikeCallCount).toBeGreaterThan(0);
	});
});
