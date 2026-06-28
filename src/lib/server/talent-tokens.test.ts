import { describe, expect, it } from 'vitest';

import { formatComponentTokenValue } from '$lib/game-engine/component-format';
import { getTalentValueTokenMap } from '$lib/server/talent-tokens';

describe('talent value tokens', () => {
	const tokens = getTalentValueTokenMap();

	it('maps percentage-decrease talents to the MultiplyDecrease token', () => {
		// Base Aiming Dispersion: {LevelValuePercentMultiplyDecrease}, values 0.97 … 0.85
		expect(tokens['Gameplay.TalentTree.Bush.Talent010']).toBe(
			'LevelValuePercentMultiplyDecrease'
		);
	});

	it('maps percentage-increase talents to the MultiplyIncrease token', () => {
		// Turret Traverse Speed: {LevelValuePercentMultiplyIncrease}
		expect(tokens['Gameplay.TalentTree.Bush.Talent001']).toBe(
			'LevelValuePercentMultiplyIncrease'
		);
	});

	it('omits flat (LevelValue) talents so they fall back to plain numbers', () => {
		// Shell Damage: {LevelValue}
		expect(tokens['Gameplay.TalentTree.Bush.Talent002']).toBeUndefined();
	});

	it('renders a multiplier decrease as a reduction percentage', () => {
		// 0.85 multiplier → 15% reduction; 0.97 per point → 3%
		expect(formatComponentTokenValue('LevelValuePercentMultiplyDecrease', 0.85)).toBe('15%');
		expect(formatComponentTokenValue('LevelValuePercentMultiplyDecrease', 0.97)).toBe('3%');
	});

	it('renders a multiplier increase as a gain percentage', () => {
		expect(formatComponentTokenValue('LevelValuePercentMultiplyIncrease', 1.24)).toBe('24%');
		expect(formatComponentTokenValue('LevelValuePercentMultiplyIncrease', 1.08)).toBe('8%');
	});

	it('renders an absolute token as its magnitude, dropping the sign', () => {
		expect(formatComponentTokenValue('LevelValueAbs', -2)).toBe('2');
	});

	it('renders a fractional percent token as a percentage', () => {
		expect(formatComponentTokenValue('LevelValuePercent', 0.125)).toBe('12.5%');
	});

	it('leaves a flat value untouched', () => {
		expect(formatComponentTokenValue('LevelValue', 8)).toBe('8');
	});
});
