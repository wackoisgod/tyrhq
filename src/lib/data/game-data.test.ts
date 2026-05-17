import { describe, expect, it } from 'vitest';

import { getGameDataBundle } from './game-data';

describe('game data normalization', () => {
	it('formats component descriptions with raw placeholder semantics', () => {
		const bundle = getGameDataBundle();
		const stableRangefinder = bundle.components.find(
			(component) => component.id === 'stablerangefinder'
		);
		const extendedGearing = bundle.components.find(
			(component) => component.id === 'extendedgearing'
		);

		expect(stableRangefinder?.description).toContain('reduced by 0.85');
		expect(stableRangefinder?.description).not.toContain('reduced by 0.15');
		expect(extendedGearing?.description).toContain('Increases Max Speed by 0.15');
		expect(extendedGearing?.description).not.toContain('Increases Max Speed by 1.15');
	});
});
