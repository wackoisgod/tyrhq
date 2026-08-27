import { describe, expect, it } from 'vitest';

import { getGameDataBundle, getGameSnapshot } from './game-data';
import { calculateRealAccelerationMps2 } from './vehicle-real-acceleration';

describe('game data normalization', () => {
	it('formats component descriptions with raw placeholder semantics', () => {
		const bundle = getGameDataBundle();
		const stableRangefinder = bundle.components.find(
			(component) => component.id === 'stablerangefinder'
		);
		const extendedGearing = bundle.components.find(
			(component) => component.id === 'extendedgearing'
		);

		// Percent-multiply tokens render as percentages, not raw fractions.
		// StableRangefinder pointValue 0.15 → multiplier on aim time, so the
		// reduction is (1 - 0.15) = 85%. ExtendedGearing 1.15 → +15%.
		expect(stableRangefinder?.description).toContain('reduced by 85%');
		expect(stableRangefinder?.description).not.toContain('reduced by 0.85');
		expect(extendedGearing?.description).toContain('Increases Max Speed by 15%');
		expect(extendedGearing?.description).not.toContain('Increases Max Speed by 0.15');
		expect(extendedGearing?.description).not.toContain('Increases Max Speed by 1.15');
	});

	it('preserves exported vehicle weight in tank summaries', () => {
		const bundle = getGameDataBundle();
		const summariesById = new Map(getGameSnapshot().tanks.map((tank) => [tank.id, tank]));

		for (const vehicle of bundle.vehicles) {
			expect(vehicle.weightKg, `${vehicle.id}.weightKg`).toBeGreaterThan(0);
			expect(summariesById.get(vehicle.id)?.weightKg).toBe(vehicle.weightKg);
		}
	});

	it('calculates every vehicle real acceleration from its exported mobility stats', () => {
		const bundle = getGameDataBundle();
		const summariesById = new Map(getGameSnapshot().tanks.map((tank) => [tank.id, tank]));

		for (const vehicle of bundle.vehicles) {
			const value = calculateRealAccelerationMps2(
				vehicle.stats.MaxSpeed,
				vehicle.stats.AccelerationTime
			);
			expect(value, `${vehicle.id}.realAccelerationMps2`).toBeGreaterThan(0);
			expect(summariesById.get(vehicle.id)?.stats.realAccelerationMps2).toBe(value);
		}
	});

	it('matches representative values from spreadsheet column P', () => {
		expect(calculateRealAccelerationMps2(57, 4.5)).toBeCloseTo(3.333333333, 9);
		expect(calculateRealAccelerationMps2(46.5, 4.25)).toBeCloseTo(2.879256966, 9);
		expect(calculateRealAccelerationMps2(23, 2.5)).toBeCloseTo(2.421052632, 9);
		expect(calculateRealAccelerationMps2(57, 0)).toBe(0);
	});
});
