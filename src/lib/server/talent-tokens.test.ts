import { describe, expect, it } from 'vitest';

import { getGameDataBundle } from '$lib/data/game-data';
import { getTalentValueTokens } from './talent-tokens';

describe('getTalentValueTokens', () => {
	it('recovers percent tokens for Valor (Healer) Module Damage', () => {
		const tokens = getTalentValueTokens();
		expect(tokens['healer-talent017']).toEqual(['LevelValuePercent', 'PointValuePercent']);
	});

	it('recovers absolute tokens for Ability Cooldown talents', () => {
		const tokens = getTalentValueTokens();
		expect(tokens['healer-talent019']).toEqual(['LevelValueAbs', 'PointValueAbs']);
	});

	it('covers every runtime talent that renders value placeholders', () => {
		const tokens = getTalentValueTokens();
		const bundle = getGameDataBundle();

		// Known drift between the raw drop and the generated runtime: the drone
		// deploy-range talent was reworded in the raw data and no longer carries
		// placeholders, so it legitimately has no token data.
		const knownDrift = new Set(['drone-talent027']);

		for (const talent of bundle.talents) {
			if (knownDrift.has(talent.id)) continue;
			const placeholderCount = (talent.description.match(/\bvalue\b/gi) ?? []).length;
			if (placeholderCount === 0) continue;
			expect(tokens[talent.id], `${talent.id} is missing token data`).toBeDefined();
			expect(
				tokens[talent.id].length,
				`${talent.id} token count differs from its value placeholders`
			).toBe(placeholderCount);
		}
	});
});
