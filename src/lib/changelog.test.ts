import { describe, expect, it } from 'vitest';

import { changelog, type ChangelogTag } from './changelog';

const tags = new Set<ChangelogTag>(['New', 'Improved', 'Fixed']);

function isRealDate(iso: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const parsed = new Date(Date.UTC(year, month - 1, day));
	return (
		parsed.getUTCFullYear() === year &&
		parsed.getUTCMonth() + 1 === month &&
		parsed.getUTCDate() === day
	);
}

describe('changelog', () => {
	it('is sorted newest first', () => {
		expect(changelog.length).toBeGreaterThan(0);
		for (let index = 1; index < changelog.length; index += 1) {
			expect(changelog[index - 1].date >= changelog[index].date).toBe(true);
		}
	});

	it('uses valid dates and non-empty player-facing entries', () => {
		for (const entry of changelog) {
			expect(isRealDate(entry.date)).toBe(true);
			expect(entry.title.trim().length).toBeGreaterThan(0);
			expect(entry.items.length).toBeGreaterThan(0);
			for (const item of entry.items) {
				expect(tags.has(item.tag)).toBe(true);
				expect(item.text.trim().length).toBeGreaterThan(0);
			}
		}
	});
});
