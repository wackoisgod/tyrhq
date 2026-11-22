/**
 * Tests for auth callback email confirmation handler
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

describe('Auth Callback - Email Confirmation', () => {
	let mockEvent: Partial<RequestEvent>;
	let mockSupabase: any;

	beforeEach(() => {
		mockSupabase = {
			auth: {
				exchangeCodeForSession: vi.fn()
			}
		};

		mockEvent = {
			url: new URL('http://localhost:5173/auth/callback'),
			locals: {
				supabase: mockSupabase
			}
		};
	});

	describe('Email confirmation success', () => {
		it('should show success message when link=email marker present', async () => {
			mockEvent.url = new URL(
				'http://localhost:5173/auth/callback?code=test-code&next=/settings&link=email'
			);

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: { session: {} },
				error: null
			});

			try {
				await GET(mockEvent as RequestEvent);
			} catch (err: any) {
				// Should redirect to /settings?success=email_confirmed
				expect(err.status).toBe(303);
				expect(err.location).toContain('/settings');
				expect(err.location).toContain('success=email_confirmed');
			}
		});

		it('should not show success message when link marker absent (normal sign-in)', async () => {
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
				expect(err.location).not.toContain('success=email_confirmed');
			}
		});
	});

	describe('Email error handling', () => {
		it('should map email_exists error code', async () => {
			mockEvent.url = new URL(
				'http://localhost:5173/auth/callback?error=invalid_request&error_code=email_exists&error_description=Email+already+in+use&link=email'
			);

			try {
				await GET(mockEvent as RequestEvent);
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
				await GET(mockEvent as RequestEvent);
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
				await GET(mockEvent as RequestEvent);
			} catch (err: any) {
				expect(err.status).toBe(303);
				expect(err.location).toContain('/settings');
				expect(err.location).toContain('error=email_change_failed');
			}
		});

		it('should use auth_callback_failed for errors in non-email flow', async () => {
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
				await GET(mockEvent as RequestEvent);
			} catch (err: any) {
				expect(err.status).toBe(303);
				expect(err.location).toContain('/settings');
				expect(err.location).toContain('error=email_change_failed');
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
});
