import { describe, expect, it } from 'vitest';

import { getGameDataBundle } from '$lib/data/game-data';
import {
	componentSupportsMaxStacks,
	computeBuild,
	createPlannerCatalog,
	getDefaultSelection
} from '$lib/game-engine/build';

/**
 * Regression for the REDIRECTOR GEAR report: "Effect doubles while you are reloading"
 * is exported as a second, WhileReloading-bound +12% GE, so the doubling belongs to the
 * conditional-effects toggle only. "Assume max stacks" used to scale both GEs by the
 * tooltip's ×2 as well, showing +48% instead of +24% (Tempest: 71.04 vs 59.52 deg/s).
 */
describe('REDIRECTOR GEAR hull traverse', () => {
	const catalog = createPlannerCatalog(getGameDataBundle());
	const redirector = catalog.componentById.get('redirectorgear')!;
	const selection = {
		...getDefaultSelection(catalog, 'recall'),
		componentIds: ['redirectorgear', '', '']
	};
	const hullTraverse = (includeConditionalEffects: boolean, assumeMaxStacks: boolean) =>
		computeBuild(catalog, selection, { includeConditionalEffects, assumeMaxStacks })!.stats
			.HullTraverseSpeed;

	it('is not affected by the max stacks option', () => {
		expect(componentSupportsMaxStacks(redirector, catalog.effectById)).toBe(false);
		expect(hullTraverse(false, true)).toBeCloseTo(hullTraverse(false, false), 4);
		expect(hullTraverse(true, true)).toBeCloseTo(hullTraverse(true, false), 4);
	});

	it('doubles from +12% to +24% only with conditional effects', () => {
		expect(hullTraverse(false, false)).toBeCloseTo(48 * 1.12, 2);
		expect(hullTraverse(true, false)).toBeCloseTo(48 * 1.24, 2);
	});
});
