import { describe, expect, it } from 'vitest';

import { dayKey, spanDayKeys } from './event-days';

// Build ISO strings from local-time components so assertions hold in any
// timezone the test runner happens to use.
function localIso(year: number, month: number, day: number, hour = 12): string {
	return new Date(year, month - 1, day, hour).toISOString();
}

describe('dayKey', () => {
	it('formats a zero-padded local date key', () => {
		expect(dayKey(new Date(2026, 7, 7))).toBe('2026-08-07');
		expect(dayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
	});
});

describe('spanDayKeys', () => {
	it('returns a single day for an event with no end', () => {
		expect(spanDayKeys(localIso(2026, 8, 7), null)).toEqual(['2026-08-07']);
	});

	it('returns a single day for a same-day range', () => {
		expect(spanDayKeys(localIso(2026, 8, 7, 10), localIso(2026, 8, 7, 20))).toEqual([
			'2026-08-07'
		]);
	});

	it('spans every day the event touches, across month boundaries', () => {
		expect(spanDayKeys(localIso(2026, 8, 30), localIso(2026, 9, 2))).toEqual([
			'2026-08-30',
			'2026-08-31',
			'2026-09-01',
			'2026-09-02'
		]);
	});

	it('returns [] for unparsable input', () => {
		expect(spanDayKeys('whenever', null)).toEqual([]);
	});

	it('caps runaway spans defensively', () => {
		const keys = spanDayKeys(localIso(2026, 1, 1), localIso(2027, 1, 1));
		expect(keys.length).toBe(40);
	});
});
