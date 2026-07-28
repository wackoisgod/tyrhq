import { describe, expect, it } from 'vitest';

import { getGameDataBundle } from '$lib/data/game-data';
import {
	computeBuild,
	createPlannerCatalog,
	formatStatValue,
	getDefaultSelection,
	isConditionalTalent
} from '$lib/game-engine/build';

/**
 * Regression coverage for the ITAD stat-breakdown reports (Ark = "bush"):
 * the in-game tech tree shows 24.00% (+8.00%/pt) turret traverse, 5.60% (+2.80%/pt)
 * hull traverse at 2/5, and 15.00% (−3.00%/pt) base aiming dispersion at 5/5,
 * and the breakdown table must reflect exactly those changes.
 */
describe('Ark stat breakdown reports', () => {
	const catalog = createPlannerCatalog(getGameDataBundle());

	function computeWith(talentPoints: Record<string, number>) {
		const selection = getDefaultSelection(catalog, 'bush');
		selection.talentPoints = talentPoints;
		const build = computeBuild(catalog, selection);
		expect(build).not.toBeNull();
		return build!;
	}

	it('applies traverse and dispersion talents at the tooltip percentages', () => {
		const build = computeWith({
			'bush-talent001': 3, // Turret Traverse Speed 3/3 → +24%
			'bush-talent007': 2, // Hull Traverse Speed 2/5 → +5.6%
			'bush-talent010': 5 // Base Aiming Dispersion 5/5 → −15%
		});

		expect(build.stats.TurretTraverseSpeed).toBeCloseTo(28 * 1.24, 3);
		expect(build.stats.HullTraverseSpeed).toBeCloseTo(35 * 1.056, 3);
		expect(build.stats.BaseDispersionPenalty).toBeCloseTo(0.14 * 0.85, 4);
	});

	it('shows the full base dispersion reduction instead of rounding it away', () => {
		const build = computeWith({ 'bush-talent010': 5 });
		const card = build.statCards.find((c) => c.definition.key === 'BaseDispersionPenalty')!;
		// Previously "0.12" / "-0.02", which reads as −14.3% instead of the game's −15%.
		expect(formatStatValue(card.value)).toBe('0.119');
		expect(formatStatValue(card.delta)).toBe('-0.021');
	});

	it('treats base aiming dispersion as a permanent passive, not situational', () => {
		const talent = catalog.talentById.get('bush-talent010')!;
		expect(isConditionalTalent(talent)).toBe(false);

		const build = computeWith({ 'bush-talent010': 5 });
		const entries = build.breakdown.BaseDispersionPenalty ?? [];
		expect(entries).toHaveLength(1);
		expect(entries[0].conditional).toBeUndefined();

		// Excluding conditional effects must NOT drop the reduction.
		const selection = getDefaultSelection(catalog, 'bush');
		selection.talentPoints = { 'bush-talent010': 5 };
		const withoutConditionals = computeBuild(catalog, selection, {
			includeConditionalEffects: false
		})!;
		expect(withoutConditionals.stats.BaseDispersionPenalty).toBeCloseTo(0.14 * 0.85, 4);
	});

	it('surfaces the reported missing talents in the stat breakdown', () => {
		const build = computeWith({
			'bush-talent005': 3, // Secondary Shells +9
			'bush-talent009': 1, // Tertiary Shells +3
			'bush-talent011': 5, // Module Damage Energy +4 (event energy)
			'bush-talent014': 2, // Precision Aiming −2s
			'bush-talent015': 3, // Tracking Assist Energy ×1.3375
			'bush-talent018': 5, // Penetration Reload Reduction −1s active reload
			'bush-talent023': 5 // Max Gun Depression −3°
		});

		expect(build.stats.StartingSecondaryShellsCount).toBeCloseTo(2 + 9, 4);
		expect(build.stats.StartingTertiaryShellsCount).toBeCloseTo(0 + 3, 4);
		expect(build.stats.CurrentAbilityResource).toBeCloseTo(4, 4);
		expect(build.stats.PreciseDispersionTime).toBeCloseTo(5 - 2, 4);
		expect(build.stats.TrackModuleDamagedAssistModifier).toBeCloseTo(1.3375, 3);
		expect(build.stats.ActiveReloadReductionTime).toBeCloseTo(-1, 4);
		expect(build.stats.GunMaxDepression).toBeCloseTo(-12, 4);

		// Every one of these lands on a visible stat card with a breakdown entry.
		for (const key of [
			'StartingSecondaryShellsCount',
			'StartingTertiaryShellsCount',
			'CurrentAbilityResource',
			'PreciseDispersionTime',
			'TrackModuleDamagedAssistModifier',
			'ActiveReloadReductionTime',
			'GunMaxDepression'
		]) {
			expect(build.breakdown[key]?.length, `${key} has no breakdown entry`).toBeGreaterThan(0);
			expect(
				build.statCards.some((card) => card.definition.key === key),
				`${key} has no stat card`
			).toBe(true);
		}

		// The shell-count cards belong in the Weapon tab, as reported.
		const secondary = build.statCards.find(
			(card) => card.definition.key === 'StartingSecondaryShellsCount'
		)!;
		expect(secondary.definition.group).toBe('Weapon');
		expect(secondary.base).toBe(2);
	});
});
