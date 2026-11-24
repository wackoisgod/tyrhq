/**
 * Tests for auth callback handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '../../routes/auth/callback/+server';

// Mock dependencies
vi.mock('$lib/server/security', () => ({
	sanitizePostAuthRedirect: (path: string | null) => {
		if (!path || !path.startsWith('/') || path.startsWith('//')) {
			return '/';
		}
		return path;
	}
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		MERGE_SECRET: 'a'.repeat(64)
	}
}));

describe('Auth Callback Handler', () => {
	let mockEvent: any;
	let mockSupabase: any;

	beforeEach(() => {
		mockSupabase = {
			auth: {
				exchangeCodeForSession: vi.fn(),
				getUser: vi.fn()
			}
		};

	mockEvent = {
		url: new URL('http://localhost:5173/auth/callback'),
		locals: {
			supabase: mockSupabase,
			safeGetSession: vi.fn().mockResolvedValue({
				session: null,
				user: null,
				role: 'user'
			})
		},
		cookies: {
			get: () => undefined,
			set: vi.fn(),
			delete: vi.fn(),
			getAll: vi.fn().mockReturnValue([]),
			serialize: vi.fn().mockReturnValue('')
		}
	};
	});

	describe('Link success marker', () => {
		it('should show success banner when link=google marker present and user has Google identity', async () => {
			mockEvent.url = new URL(
				'http://localhost:5173/auth/callback?code=test-code&next=/settings&link=google'
			);

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: { session: {} },
				error: null
			});

			mockSupabase.auth.getUser.mockResolvedValue({
				data: {
					user: {
						identities: [
							{ provider: 'google', id: 'google-id' }
						]
					}
				},
				error: null
			});

			try {
				await GET(mockEvent);
			} catch (err: any) {
				// Should redirect to /settings?success=google_linked
				expect(err.status).toBe(303);
				expect(err.location).toContain('/settings');
				expect(err.location).toContain('success=google_linked');
			}
		});

		it('should not show success banner when link marker absent (normal sign-in to settings)', async () => {
			mockEvent.url = new URL(
				'http://localhost:5173/auth/callback?code=test-code&next=/settings'
			);

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: { session: {} },
				error: null
			});

			try {
				await GET(mockEvent);
			} catch (err: any) {
				// Should redirect to /settings without success param
				expect(err.status).toBe(303);
				expect(err.location).toBe('/settings');
				expect(err.location).not.toContain('success=google_linked');
			}
		});

	it('should initiate merge when Google identity is not linked after OAuth', async () => {
		expect.assertions(3);
		
		mockEvent.url = new URL(
			'http://localhost:5173/auth/callback?code=test-code&next=/settings&link=google'
		);

		mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
			data: { session: {} },
			error: null
		});

		// User has no Google identity - means it exists on another account
		mockSupabase.auth.getUser.mockResolvedValue({
			data: {
				user: {
					id: 'user-primary-123',
					identities: []
				}
			},
			error: null
		});
		
		mockSupabase.auth.signOut = vi.fn().mockResolvedValue({ error: null });

		try {
			await GET(mockEvent);
		} catch (err: any) {
			// Should initiate merge flow by redirecting to auth with merge marker
			expect(err.status).toBe(303);
			expect(err.location).toBe('/auth?merge=1&provider=google');
			// Should have called signOut
			expect(mockSupabase.auth.signOut).toHaveBeenCalled();
		}
	});
	});

	describe('Link error_code mapping', () => {
	it('should initiate merge when identity_already_exists error code for Google', async () => {
		expect.assertions(3);
		
		mockEvent.url = new URL(
			'http://localhost:5173/auth/callback?error=invalid_request&error_code=identity_already_exists&error_description=Identity+is+already+linked&link=google'
		);
		
		mockSupabase.auth.getUser.mockResolvedValue({
			data: {
				user: {
					id: 'user-primary-123',
					identities: []
				}
			},
			error: null
		});
		
		mockSupabase.auth.signOut = vi.fn().mockResolvedValue({ error: null });

		try {
			await GET(mockEvent);
		} catch (err: any) {
			expect(err.status).toBe(303);
			expect(err.location).toBe('/auth?merge=1&provider=google');
			expect(mockSupabase.auth.signOut).toHaveBeenCalled();
		}
	});
		
	it('should initiate merge when error description contains "already linked" for Google', async () => {
		expect.assertions(3);
		
		mockEvent.url = new URL(
			'http://localhost:5173/auth/callback?error=invalid_request&error_description=Identity+is+already+linked+to+another+user&link=google'
		);
		
		mockSupabase.auth.getUser.mockResolvedValue({
			data: {
				user: {
					id: 'user-primary-456',
					identities: []
				}
			},
			error: null
		});
		
		mockSupabase.auth.signOut = vi.fn().mockResolvedValue({ error: null });

		try {
			await GET(mockEvent);
		} catch (err: any) {
			expect(err.status).toBe(303);
			expect(err.location).toBe('/auth?merge=1&provider=google');
			expect(mockSupabase.auth.signOut).toHaveBeenCalled();
		}
	});

		it('should map manual_linking_disabled error code', async () => {
			mockEvent.url = new URL(
				'http://localhost:5173/auth/callback?error=invalid_request&error_code=manual_linking_disabled&link=google'
			);

			try {
				await GET(mockEvent);
			} catch (err: any) {
				expect(err.status).toBe(303);
				expect(err.location).toContain('/settings');
				expect(err.location).toContain('error=manual_linking_disabled');
			}
		});

		it('should map provider_disabled to manual_linking_disabled', async () => {
			mockEvent.url = new URL(
				'http://localhost:5173/auth/callback?error=invalid_request&error_code=provider_disabled&link=google'
			);

			try {
				await GET(mockEvent);
			} catch (err: any) {
				expect(err.status).toBe(303);
				expect(err.location).toContain('/settings');
				expect(err.location).toContain('error=manual_linking_disabled');
			}
		});

		it('should use link_failed for unknown error codes in link flow', async () => {
			mockEvent.url = new URL(
				'http://localhost:5173/auth/callback?error=invalid_request&error_code=unknown_error&link=google'
			);

			try {
				await GET(mockEvent);
			} catch (err: any) {
				expect(err.status).toBe(303);
				expect(err.location).toContain('/settings');
				expect(err.location).toContain('error=link_failed');
			}
		});

		it('should use auth_callback_failed for errors in non-link flow', async () => {
			mockEvent.url = new URL(
				'http://localhost:5173/auth/callback?error=invalid_request&error_code=some_error&next=/dashboard'
			);

			try {
				await GET(mockEvent);
			} catch (err: any) {
				expect(err.status).toBe(303);
				expect(err.location).toContain('error=auth_callback_failed');
			}
		});
	});

describe('Sanitization', () => {
	it('should redirect auth errors to /auth regardless of next parameter', async () => {
		// No code, should fall back to error redirect at /auth
		mockEvent.url = new URL(
			'http://localhost:5173/auth/callback?next=/dashboard'
		);

		try {
			await GET(mockEvent);
		} catch (err: any) {
			expect(err.status).toBe(303);
			expect(err.location).toContain('/auth');
			expect(err.location).toContain('error=auth_callback_failed');
		}
	});

it('should default to /auth when next is not provided', async () => {
	mockEvent.url = new URL('http://localhost:5173/auth/callback');

	try {
		await GET(mockEvent);
	} catch (err: any) {
		expect(err.status).toBe(303);
		expect(err.location).toContain('/auth');
		expect(err.location).toContain('error=auth_callback_failed');
	}
});
});

	describe('Exchange errors', () => {
		it('should redirect to settings with error when link flow exchange fails', async () => {
			mockEvent.url = new URL(
				'http://localhost:5173/auth/callback?code=bad-code&link=google'
			);

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: null,
				error: { message: 'Invalid code' }
			});

			try {
				await GET(mockEvent);
			} catch (err: any) {
				expect(err.status).toBe(303);
				expect(err.location).toContain('/settings');
				expect(err.location).toContain('error=link_failed');
			}
		});
	});
});
