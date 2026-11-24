import { describe, expect, it } from 'vitest';

import { formatDate } from './format-date';

describe('formatDate', () => {
	it('formats a medium date, short time, and timezone name without throwing', () => {
		const formatted = formatDate('2026-11-24T17:13:00.000Z');

		expect(formatted.trim().length).toBeGreaterThan(0);
		expect(formatted).not.toBe('Invalid Date');
	});

	it('rejects dateStyle and timeStyle combined with timeZoneName', () => {
		expect(() =>
			new Date('2026-11-24T17:13:00.000Z').toLocaleString([], {
				dateStyle: 'medium',
				timeStyle: 'short',
				timeZoneName: 'short'
			})
		).toThrow(TypeError);
	});
});
