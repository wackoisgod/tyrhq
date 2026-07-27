import { describe, expect, it } from 'vitest';

import {
	extractTalentValueTokens,
	fillTalentDescription,
	formatTalentTokenValue
} from './component-format';

describe('extractTalentValueTokens', () => {
	it('returns placeholder tokens in description order', () => {
		expect(
			extractTalentValueTokens(
				'Increases damage against modules by {LevelValuePercent} (+{PointValuePercent} per point)'
			)
		).toEqual(['LevelValuePercent', 'PointValuePercent']);
	});

	it('ignores text without placeholders', () => {
		expect(extractTalentValueTokens('Triples the deployment range of the drone')).toEqual([]);
	});
});

describe('formatTalentTokenValue', () => {
	it('scales percent tokens to whole percentages', () => {
		expect(formatTalentTokenValue('LevelValuePercent', 0.07400000095367432)).toBe('7.4%');
		expect(formatTalentTokenValue('PointValuePercent', 0.03700000047683716)).toBe('3.7%');
	});

	it('renders absolute tokens without sign', () => {
		expect(formatTalentTokenValue('LevelValueAbs', -4)).toBe('4');
		expect(formatTalentTokenValue('PointValueAbs', -2)).toBe('2');
	});

	it('converts multiplier tokens to percent deltas', () => {
		expect(formatTalentTokenValue('LevelValuePercentMultiplyIncrease', 1.0839999914169312)).toBe(
			'8.4%'
		);
		expect(formatTalentTokenValue('PointValuePercentMultiplyDecrease', 0.972)).toBe('2.8%');
	});
});

describe('fillTalentDescription', () => {
	const moduleDamageDescription = 'Increases damage against modules by value (+value per point)';
	const moduleDamageValues = [0.03700000047683716, 0.07400000095367432];
	const moduleDamageTokens = ['LevelValuePercent', 'PointValuePercent'] as const;

	it('renders percent talents on the same scale as the game', () => {
		// Valor (Healer) Module Damage — the game shows 3.70% per point.
		expect(
			fillTalentDescription(
				moduleDamageDescription,
				moduleDamageValues,
				[...moduleDamageTokens],
				1,
				2
			)
		).toBe('Increases damage against modules by 3.7% (+3.7% per point)');
	});

	it('previews the node-cap value when unallocated', () => {
		expect(
			fillTalentDescription(
				moduleDamageDescription,
				moduleDamageValues,
				[...moduleDamageTokens],
				0,
				2
			)
		).toBe('Increases damage against modules by 7.4% (+3.7% per point)');
	});

	it('renders absolute tokens so literal signs in the text read correctly', () => {
		expect(
			fillTalentDescription(
				'Reduces Ability Cooldown by value seconds (-value seconds per point)',
				[-2, -4],
				['LevelValueAbs', 'PointValueAbs'],
				0,
				2
			)
		).toBe('Reduces Ability Cooldown by 4 seconds (-2 seconds per point)');
	});

	it('renders multiplier point values as percent deltas', () => {
		expect(
			fillTalentDescription(
				'Increases Hull Traverse Speed by value (+value per point)',
				[1.027999997138977, 1.055999994277954, 1.0839999914169312],
				['LevelValuePercentMultiplyIncrease', 'PointValuePercentMultiplyIncrease'],
				0,
				3
			)
		).toBe('Increases Hull Traverse Speed by 8.4% (+2.8% per point)');
	});

	it('falls back to plain numbers when no token data exists', () => {
		expect(
			fillTalentDescription(
				'Damaging an enemy module generates value Energy (+value per point)',
				[0.699999988079071, 1.399999976158142],
				[],
				0,
				2
			)
		).toBe('Damaging an enemy module generates 1.4 Energy (+0.7 per point)');
	});

	it('leaves extra value words untouched when the token list runs out', () => {
		expect(
			fillTalentDescription(
				'Increases value and also mentions value twice more: value',
				[0.1, 0.2],
				['LevelValuePercent'],
				0,
				2
			)
		).toBe('Increases 20% and also mentions value twice more: value');
	});
});
