import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_SITE_URL: 'https://www.tyrhq.com' }
}));

import { getAbsoluteUrl, getAuthCallbackUrl } from './site-url';

describe('auth callbacks with a production canonical URL', () => {
	it.each([
		'https://tyrhq-git-feature-tournaments-example.vercel.app',
		'https://aggrowebsite-k4n52usuu-aspiering-8136s-projects.vercel.app',
		'http://localhost:5173',
		'https://www.tyrhq.com'
	])('returns authentication to %s', (origin) => {
		expect(getAuthCallbackUrl(origin)).toBe(`${origin}/auth/callback`);
	});

	it('keeps the password-reset destination on the preview', () => {
		const callback = new URL(getAuthCallbackUrl('https://preview.example.test', '/auth'));

		expect(callback.origin).toBe('https://preview.example.test');
		expect(callback.pathname).toBe('/auth/callback');
		expect(callback.searchParams.get('next')).toBe('/auth');
	});

	it('still uses the canonical production origin for public links', () => {
		expect(getAbsoluteUrl('/builds/example', 'https://preview.example.test')).toBe(
			'https://www.tyrhq.com/builds/example'
		);
	});
});
