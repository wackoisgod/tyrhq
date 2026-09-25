import { describe, expect, it } from 'vitest';

import runtimeData from '$gamedata/generated/runtime.json';

import { getAmmoFixedStats } from './ammo-fixed-stats';

describe('getAmmoFixedStats', () => {
	it('reads fixed penetration and velocity from shell descriptions', () => {
		expect(getAmmoFixedStats({ description: 'Deals 20% more damage but has fixed 45mm penetration.' })).toEqual({
			ShellPenetration: 45
		});
		expect(getAmmoFixedStats({ description: 'Travels at a fixed 500 m/s.' })).toEqual({ ShellVelocity: 500 });
		expect(getAmmoFixedStats({ description: 'A shell with greatly improved accuracy and travel speed.' })).toEqual({});
		expect(getAmmoFixedStats(null)).toEqual({});
	});

	it('finds the fixed stats in the exported HE and Momentum shells', () => {
		const ammo = (runtimeData as { ammo: Array<{ id: string; description: string }> }).ammo;
		const byId = new Map(ammo.map((entry) => [entry.id, entry]));
		expect(getAmmoFixedStats(byId.get('highexplosive'))).toEqual({ ShellPenetration: 45 });
		expect(getAmmoFixedStats(byId.get('momentum'))).toEqual({ ShellVelocity: 500 });
	});
});
