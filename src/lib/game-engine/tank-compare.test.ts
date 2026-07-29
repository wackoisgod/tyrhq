import { describe, expect, it } from 'vitest';

import { getCompareTanks } from '$lib/data/game-data';
import {
	bestCompareValue,
	compareRatingRows,
	compareSections,
	compareStatKeys,
	formatCompareValue,
	scaleCompareValue,
	shouldShowCompareRow
} from './tank-compare';

describe('compare stat definitions', () => {
	it('every compare stat key exists on every vehicle in the runtime data', () => {
		const tanks = getCompareTanks();
		expect(tanks.length).toBeGreaterThan(0);
		for (const tank of tanks) {
			for (const key of compareStatKeys) {
				expect(tank.stats[key], `${tank.id}.${key}`).toBeTypeOf('number');
				expect(Number.isFinite(tank.stats[key]), `${tank.id}.${key}`).toBe(true);
			}
		}
	});

	it('inherits label, unit and direction from the shared stat definitions', () => {
		const reload = compareSections
			.flatMap((section) => section.rows)
			.find((entry) => entry.key === 'ReloadTime');
		expect(reload).toMatchObject({ label: 'Reload Time', unit: 's', better: 'lower' });
	});

	it('treats detection radius as lower-is-better (it is the tank signature radius)', () => {
		const detection = compareSections
			.flatMap((section) => section.rows)
			.find((entry) => entry.key === 'DetectionRadius');
		expect(detection?.better).toBe('lower');
	});

	it('all rating rows highlight the higher value', () => {
		for (const entry of compareRatingRows) {
			expect(entry.better, entry.key).toBe('higher');
		}
	});
});

describe('bestCompareValue', () => {
	it('picks the max for higher-is-better rows', () => {
		expect(bestCompareValue([110, 400, 282], 'higher')).toBe(400);
	});

	it('picks the min for lower-is-better rows', () => {
		expect(bestCompareValue([2.5, 15, 8], 'lower')).toBe(2.5);
	});

	it('picks the most negative gun depression as best', () => {
		expect(bestCompareValue([-11, -6], 'lower')).toBe(-11);
	});

	it('returns null on a tie so nothing is falsely highlighted', () => {
		expect(bestCompareValue([400, 400, 400], 'higher')).toBeNull();
	});

	it('returns null for neutral rows and single values', () => {
		expect(bestCompareValue([100, 46], 'none')).toBeNull();
		expect(bestCompareValue([100], 'higher')).toBeNull();
		expect(bestCompareValue([null, undefined, 100], 'higher')).toBeNull();
	});
});

describe('row visibility and formatting', () => {
	it('hides rows where every tank reads zero (e.g. strafe on tracked hulls)', () => {
		expect(shouldShowCompareRow([0, 0, 0])).toBe(false);
		expect(shouldShowCompareRow([0, 40])).toBe(true);
		expect(shouldShowCompareRow([-11, -6])).toBe(true);
	});

	it('formats values without trailing zero noise', () => {
		expect(formatCompareValue(15.25)).toBe('15.25');
		expect(formatCompareValue(4.5)).toBe('4.5');
		expect(formatCompareValue(57)).toBe('57');
		expect(formatCompareValue(Number.NaN)).toBe('—');
	});

	it('scales mass from kilograms to tonnes for display', () => {
		const mass = compareSections
			.flatMap((section) => section.rows)
			.find((entry) => entry.key === 'Mass');
		expect(mass).toBeDefined();
		expect(scaleCompareValue(mass!, 46000)).toBe(46);
	});
});
