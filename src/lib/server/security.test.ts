import { describe, expect, it } from 'vitest';

import { applySecurityHeaders, sanitizePostAuthRedirect } from './security';

describe('sanitizePostAuthRedirect', () => {
	it('keeps site-local relative paths', () => {
		expect(sanitizePostAuthRedirect('/settings?tab=profile')).toBe('/settings?tab=profile');
	});

	it('rejects absolute URLs', () => {
		expect(sanitizePostAuthRedirect('https://evil.test/steal')).toBe('/');
	});

	it('rejects protocol-relative URLs', () => {
		expect(sanitizePostAuthRedirect('//evil.test/steal')).toBe('/');
	});

	it('rejects backslash-prefixed paths', () => {
		expect(sanitizePostAuthRedirect('/\\evil.test')).toBe('/');
	});
});

describe('applySecurityHeaders', () => {
	const url = new URL('https://tyr.test/guides');

	it('leaves public cache headers alone for anonymous responses', () => {
		const response = new Response('', {
			headers: { 'cache-control': 'public, max-age=0, s-maxage=60' }
		});

		applySecurityHeaders(response, url);

		expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=60');
		expect(response.headers.get('x-frame-options')).toBe('DENY');
	});

	it('prevents CDN caching for authenticated responses', () => {
		const response = new Response('', {
			headers: {
				'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600',
				vary: 'Accept-Encoding'
			}
		});

		applySecurityHeaders(response, url, { privateCache: true });

		expect(response.headers.get('cache-control')).toBe(
			'private, no-cache, no-store, must-revalidate, max-age=0'
		);
		expect(response.headers.get('expires')).toBe('0');
		expect(response.headers.get('pragma')).toBe('no-cache');
		expect(response.headers.get('vary')).toBe('Accept-Encoding, Cookie');
	});

	it('applies Supabase auth cookie headers before final cache protection', () => {
		const response = new Response('', {
			headers: { 'cache-control': 'public, max-age=0, s-maxage=60' }
		});

		applySecurityHeaders(response, url, {
			privateCache: true,
			extraHeaders: {
				'cache-control': 'private, no-cache, no-store, must-revalidate, max-age=0',
				expires: '0',
				pragma: 'no-cache'
			}
		});

		expect(response.headers.get('cache-control')).toBe(
			'private, no-cache, no-store, must-revalidate, max-age=0'
		);
		expect(response.headers.get('vary')).toBe('Cookie');
	});
});
