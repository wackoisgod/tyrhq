import { describe, expect, it } from 'vitest';

import { getGameDataBundle } from '$lib/data/game-data';
import { calculateFirepower } from './firepower';

describe('calculateFirepower', () => {
	it('ignores the intra-clip gap for single-shot guns', () => {
		const firepower = calculateFirepower({
			ShellDamage: 110,
			ReloadTime: 2.5,
			ClipSize: 1,
			IntraClipReloadTime: 1.5
		});
		expect(firepower?.cycleTime).toBeCloseTo(2.5, 6);
		expect(firepower?.burstDamage).toBe(110);
		expect(firepower?.dpm).toBeCloseTo(2640, 6);
	});

	it('adds one intra-clip gap per follow-up shot for clip guns', () => {
		// 5-shot clip: 20 s full reload + 4 × 1 s gaps.
		const firepower = calculateFirepower({
			ShellDamage: 125,
			ReloadTime: 20,
			ClipSize: 5,
			IntraClipReloadTime: 1
		});
		expect(firepower?.cycleTime).toBeCloseTo(24, 6);
		expect(firepower?.burstDamage).toBe(625);
		expect(firepower?.dpm).toBeCloseTo(1562.5, 6);
	});

	it('treats a missing clip size as a single-shot gun', () => {
		const firepower = calculateFirepower({ ShellDamage: 200, ReloadTime: 10 });
		expect(firepower?.clipSize).toBe(1);
		expect(firepower?.dpm).toBeCloseTo(1200, 6);
	});

	it('returns null when there is no reload to divide by', () => {
		expect(calculateFirepower({ ShellDamage: 200, ReloadTime: 0 })).toBeNull();
		expect(calculateFirepower({ ShellDamage: 200, ReloadTime: Number.NaN })).toBeNull();
	});

	it('produces a positive figure for every exported vehicle', () => {
		for (const vehicle of getGameDataBundle().vehicles) {
			const firepower = calculateFirepower(vehicle.stats);
			expect(firepower, vehicle.id).not.toBeNull();
			expect(firepower!.dpm, vehicle.id).toBeGreaterThan(0);
		}
	});
});
