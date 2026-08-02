import { describe, expect, it } from 'vitest';

import { getGameDataBundle } from '$lib/data/game-data';
import { extractTalentValueTokens, fillTalentDescription } from '$lib/game-engine/component-format';

describe('exported talent value tokens', () => {
	const talentById = new Map(getGameDataBundle().talents.map((talent) => [talent.id, talent]));

	it('covers every runtime talent template placeholder in order', () => {
		for (const talent of talentById.values()) {
			const templateTokens = extractTalentValueTokens(talent.descriptionTemplate ?? '');
			expect(talent.valueTokens ?? [], `${talent.id} token drift`).toEqual(templateTokens);
		}
	});

	it('includes the percent and absolute semantics for Seeker talents', () => {
		expect(talentById.get('seeker-talent003')?.valueTokens).toEqual([
			'LevelValuePercentMultiplyDecrease',
			'PointValuePercentMultiplyDecrease'
		]);
		expect(talentById.get('seeker-talent009')?.valueTokens).toEqual([
			'LevelValueAbs',
			'PointValueAbs'
		]);
	});

	it('formats Seeker multiplier values using the exported tokens', () => {
		const talent = talentById.get('seeker-talent003');
		expect(talent).toBeDefined();
		if (!talent) return;

		const description = fillTalentDescription(
			talent.description,
			talent.pointValues,
			talent.valueTokens ?? [],
			5,
			5
		);
		expect(description).toContain('15% (+3% per point)');
	});
});