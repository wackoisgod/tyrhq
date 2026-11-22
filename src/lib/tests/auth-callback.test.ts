/**
 * Tests for auth callback handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '../../routes/auth/callback/+server';
import type { RequestEvent } from '@sveltejs/kit';

// Mock dependencies
vi.mock('$lib/server/security', () => ({
	sanitizePostAuthRedirect: (path: string | null) => {
		if (!path || !path.startsWith('/') || path.startsWith('//')) {
			return '/';
		}
		return path;
	}
}));

describe('Auth Callback Handler', () => {
	let mockEvent: Partial<RequestEvent>;
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
				supabase: mockSupabase
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
				await GET(mockEvent as RequestEvent);
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
				await GET(mockEvent as RequestEvent);
			} catch (err: any) {
				// Should redirect to /settings without success param
				expect(err.status).toBe(303);
				expect(err.location).toBe('/settings');
				expect(err.location).not.toContain('success=google_linked');
			}
		});

		it('should not show success banner when user does not actually have Google identity', async () => {
			mockEvent.url = new URL(
				'http://localhost:5173/auth/callback?code=test-code&next=/settings&link=google'
			);

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: { session: {} },
				error: null
			});

			// User has no Google identity (linking failed somehow)
			mockSupabase.auth.getUser.mockResolvedValue({
				data: {
					user: {
						identities: []
					}
				},
				error: null
			});

			try {
				await GET(mockEvent as RequestEvent);
			} catch (err: any) {
				// Should redirect to /settings without success
				expect(err.status).toBe(303);
				expect(err.location).toBe('/settings');
				expect(err.location).not.toContain('success=google_linked');
			}
		});
	});

	describe('Link error_code mapping', () => {
		it('should map identity_already_exists error code', async () => {
			mockEvent.url = new URL(
				'http://localhost:5173/auth/callback?error=invalid_request&error_code=identity_already_exists&error_description=Identity+is+already+linked&link=google'
			);

			try {
				await GET(mockEvent as RequestEvent);
			} catch (err: any) {
				expect(err.status).toBe(303);
				expect(err.location).toContain('/settings');
				expect(err.location).toContain('error=identity_already_exists');
			}
		});

		it('should map manual_linking_disabled error code', async () => {
			mockEvent.url = new URL(
				'http://localhost:5173/auth/callback?error=invalid_request&error_code=manual_linking_disabled&link=google'
			);

			try {
				await GET(mockEvent as RequestEvent);
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
				await GET(mockEvent as RequestEvent);
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
				await GET(mockEvent as RequestEvent);
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
				await GET(mockEvent as RequestEvent);
			} catch (err: any) {
				expect(err.status).toBe(303);
				expect(err.location).toContain('error=auth_callback_failed');
			}
		});
	});

	describe('Sanitization', () => {
		it('should use sanitized next parameter in fallback URL', async () => {
			// No code, should fall back to error redirect
			mockEvent.url = new URL(
				'http://localhost:5173/auth/callback?next=/dashboard'
			);

			try {
				await GET(mockEvent as RequestEvent);
			} catch (err: any) {
				expect(err.status).toBe(303);
				expect(err.location).toContain('/dashboard');
				expect(err.location).toContain('error=auth_callback_failed');
				// Should be sanitized (no origin in URL)
				expect(err.location).not.toContain('http://');
			}
		});

		it('should default to /auth when next is not provided', async () => {
			mockEvent.url = new URL('http://localhost:5173/auth/callback');

			try {
				await GET(mockEvent as RequestEvent);
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
				await GET(mockEvent as RequestEvent);
			} catch (err: any) {
				expect(err.status).toBe(303);
				expect(err.location).toContain('/settings');
				expect(err.location).toContain('error=link_failed');
			}
		});
	});
});
