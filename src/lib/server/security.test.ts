import { describe, expect, it } from 'vitest';

import { sanitizePostAuthRedirect } from './security';

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
