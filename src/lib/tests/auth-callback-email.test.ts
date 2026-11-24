/**
 * Tests for auth callback email confirmation handler
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

describe('Auth Callback - Email Confirmation', () => {
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

	describe('Email confirmation success', () => {
		it('should show success message when email is confirmed and real', async () => {
			mockEvent.url = new URL(
				'http://localhost:5173/auth/callback?code=test-code&next=/settings&link=email'
			);

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: { session: {} },
				error: null
			});

			mockSupabase.auth.getUser.mockResolvedValue({
				data: {
					user: {
						email: 'user@example.com',
						email_confirmed_at: '2024-01-01T00:00:00Z'
					}
				},
				error: null
			});

			try {
				await GET(mockEvent);
			} catch (err: any) {
				// Should redirect to /settings?success=email_confirmed
				expect(err.status).toBe(303);
				expect(err.location).toContain('/settings');
				expect(err.location).toContain('success=email_confirmed');
			}
		});

		it('should not show success when email is placeholder', async () => {
			mockEvent.url = new URL(
				'http://localhost:5173/auth/callback?code=test-code&next=/settings&link=email'
			);

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: { session: {} },
				error: null
			});

			mockSupabase.auth.getUser.mockResolvedValue({
				data: {
					user: {
						email: 'steam_123456@users.tyrhq.invalid',
						email_confirmed_at: null
					}
				},
				error: null
			});

			try {
				await GET(mockEvent);
			} catch (err: any) {
				// Should redirect to /settings without success banner
				expect(err.status).toBe(303);
				expect(err.location).toBe('/settings');
				expect(err.location).not.toContain('success=email_confirmed');
			}
		});

		it('should not show success when email not confirmed yet', async () => {
			mockEvent.url = new URL(
				'http://localhost:5173/auth/callback?code=test-code&next=/settings&link=email'
			);

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: { session: {} },
				error: null
			});

			mockSupabase.auth.getUser.mockResolvedValue({
				data: {
					user: {
						email: 'user@example.com',
						email_confirmed_at: null
					}
				},
				error: null
			});

			try {
				await GET(mockEvent);
			} catch (err: any) {
				// Should redirect to /settings without success banner
				expect(err.status).toBe(303);
				expect(err.location).toBe('/settings');
				expect(err.location).not.toContain('success=email_confirmed');
			}
		});

		it('should not conflict with Google linking (link=google)', async () => {
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
				expect(err.location).toContain('success=google_linked');
				expect(err.location).not.toContain('success=email_confirmed');
			}
		});
	});

	describe('Email error handling', () => {
		it('should map email_exists error code', async () => {
			mockEvent.url = new URL(
				'http://localhost:5173/auth/callback?error=invalid_request&error_code=email_exists&link=email'
			);

			try {
				await GET(mockEvent);
			} catch (err: any) {
				expect(err.status).toBe(303);
				expect(err.location).toContain('/settings');
				expect(err.location).toContain('error=email_exists');
			}
		});

		it('should map email_not_confirmed error code', async () => {
			mockEvent.url = new URL(
				'http://localhost:5173/auth/callback?error=invalid_request&error_code=email_not_confirmed&link=email'
			);

			try {
				await GET(mockEvent);
			} catch (err: any) {
				expect(err.status).toBe(303);
				expect(err.location).toContain('/settings');
				expect(err.location).toContain('error=email_not_confirmed');
			}
		});

		it('should use email_change_failed for unknown error codes in email flow', async () => {
			mockEvent.url = new URL(
				'http://localhost:5173/auth/callback?error=invalid_request&error_code=unknown_error&link=email'
			);

			try {
				await GET(mockEvent);
			} catch (err: any) {
				expect(err.status).toBe(303);
				expect(err.location).toContain('/settings');
				expect(err.location).toContain('error=email_change_failed');
			}
		});
	});

	describe('Exchange errors for email flow', () => {
		it('should redirect to settings with error when email flow exchange fails', async () => {
			mockEvent.url = new URL(
				'http://localhost:5173/auth/callback?code=bad-code&link=email'
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
				expect(err.location).toContain('error=email_change_failed');
			}
		});
	});
});
