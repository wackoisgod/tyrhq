import { describe, expect, it } from 'vitest';

import type {
	AmmoRecord,
	ComponentRecord,
	EffectRecord,
	GameDataBundle,
	TalentRecord,
	TalentTreeRecord,
	VehicleRecord
} from '$lib/types/game';

import { computeBuild, createPlannerCatalog, type PlannerSelection } from './build';

function makeAmmo(id: string, displayName: string, damage = 1, modOverrides: Partial<AmmoRecord['modifiers']> = {}): AmmoRecord {
	return {
		id,
		key: id,
		slug: id,
		name: displayName,
		displayName,
		description: '',
		selectable: true,
		canLoadSecondary: true,
		modifiers: {
			damage,
			penetration: 1,
			reload: 1,
			dispersion: 1,
			detection: 1,
			velocity: 1,
			...modOverrides
		},
		source: { key: id }
	};
}

function makeEffect(
	id: string,
	attribute: string,
	op: 'AddBase' | 'MultiplyAdditive',
	value: number,
	options: { stackLimit?: number; magnitudeType?: 'ScalableFloat' | 'CustomCalculationClass' } = {}
): EffectRecord {
	const magnitudeType = options.magnitudeType ?? 'ScalableFloat';
	return {
		id,
		path: `/Game/Effects/GE_${id}.GE_${id}`,
		stackLimit: options.stackLimit ?? 1,
		tags: [],
		modifiers: [
			{
				attribute,
				op,
				magnitude:
					magnitudeType === 'ScalableFloat'
						? `ScalableFloatMagnitude=(Value=${value})`
						: 'MagnitudeCalculationType=CustomCalculationClass',
				magnitudeType
			}
		]
	};
}

function makeComponent(
	id: string,
	name: string,
	effectIds: string[],
	pointValues = [0],
	description = ''
): ComponentRecord {
	return {
		id,
		key: id,
		slug: id,
		name,
		description,
		categoryId: 'test',
		category: 'Test',
		pointValues,
		tagIds: [],
		eventTags: ['Gameplay.Event.LoadoutApplied'],
		effectIds,
		effectPaths: effectIds.map((e) => `/Game/Effects/GE_${e}.GE_${e}`),
		nativeVehicles: [],
		source: { key: id }
	};
}

function makeTalent(id: string, name: string, effectIds: string[], pointValues: number[], maxPoints = pointValues.length): TalentRecord {
	return {
		id,
		key: id,
		slug: id,
		name,
		description: '',
		supplementalDescription: '',
		icon: '',
		type: 'passive',
		maxPoints,
		eventTags: ['Gameplay.Event.LoadoutApplied'],
		effectIds,
		effectPaths: effectIds.map((e) => `/Game/Effects/GE_${e}.GE_${e}`),
		pointValues,
		source: { key: id }
	};
}

function makeVehicle(id: string, stats: Record<string, number>, defaultAmmo: string, treeId: string): VehicleRecord {
	return {
		id,
		key: id,
		slug: id,
		name: id,
		classId: 'medium',
		classLabel: 'Medium',
		isWorkInProgress: false,
		selectable: true,
		stats,
		ability: {
			name: 'Commander Ability',
			description: '',
			icon: ''
		},
		loadout: {
			componentSlotCount: 4,
			ammoSlotCount: 1,
			defaultAmmoIds: [defaultAmmo],
			previewAmmoSlot: 0,
			talentTreeId: treeId
		},
		nativeComponents: [],
		source: { tankKey: id, vehicleUiKey: id }
	};
}

function makeTree(id: string, vehicleId: string, talentIds: string[]): TalentTreeRecord {
	return {
		id,
		slug: id,
		name: id,
		vehicleId,
		talentCount: talentIds.length,
		version: 1,
		nodes: talentIds.map((talentId, i) => ({
			talentId,
			tier: 0,
			row: i,
			maxPoints: 2,
			isKeystone: false,
			prerequisiteIds: []
		})),
		source: { file: '' }
	};
}

function makeBundle({
	vehicles,
	ammo,
	components,
	talents,
	effects,
	trees
}: {
	vehicles: VehicleRecord[];
	ammo: AmmoRecord[];
	components: ComponentRecord[];
	talents: TalentRecord[];
	effects: EffectRecord[];
	trees: TalentTreeRecord[];
}): GameDataBundle {
	return {
		metadata: { schemaVersion: 1, generatedAt: '', rawSource: '' },
		vehicles,
		ammo,
		components,
		talents,
		talentTrees: trees,
		effects,
		armorViewer: [],
		maps: []
	} as unknown as GameDataBundle;
}

describe('computeBuild aggregator math', () => {
	it('shell damage: flat additions apply BEFORE the ammo multiplier', () => {
		// Replicates the website-vs-game discrepancy that prompted the rewrite:
		//   Game:    (125 + 7.5) × 1.20 = 159
		//   Old bug: 125 × 1.20 + 7.5    = 157.5
		const standard = makeAmmo('standard', 'Standard', 1.0);
		const he = makeAmmo('high_explosive', 'High Explosive', 1.2);
		const shellChargerEffect = makeEffect('ShellCharger', 'ShellDamage', 'AddBase', 7.5);
		const shellCharger = makeComponent('shell_charger', 'SHELL CHARGER', ['ShellCharger']);
		const vehicle = makeVehicle('test_tank', { ShellDamage: 125 }, 'standard', 'tree_test');
		const tree = makeTree('tree_test', 'test_tank', []);

		const bundle = makeBundle({
			vehicles: [vehicle],
			ammo: [standard, he],
			components: [shellCharger],
			talents: [],
			effects: [shellChargerEffect],
			trees: [tree]
		});
		const catalog = createPlannerCatalog(bundle);

		const selection: PlannerSelection = {
			vehicleId: 'test_tank',
			ammoIds: ['high_explosive'],
			previewAmmoSlot: 0,
			componentIds: ['shell_charger', '', '', ''],
			talentPoints: {}
		};

		const build = computeBuild(catalog, selection);
		expect(build).not.toBeNull();
		expect(build!.stats.ShellDamage).toBeCloseTo(159, 4);

		const breakdown = build!.breakdown.ShellDamage ?? [];
		const componentEntry = breakdown.find((e) => e.source.startsWith('Component:'));
		const ammoEntry = breakdown.find((e) => e.source.startsWith('Ammo:'));
		expect(componentEntry?.delta).toBeCloseTo(7.5, 4);
		// Ammo contribution is applied AFTER the aggregator, so it equals (125 + 7.5) × 0.20 = 26.5
		expect(ammoEntry?.delta).toBeCloseTo(26.5, 4);
		// Per-source contributions sum to (final − base):
		const total = breakdown.reduce((s, e) => s + e.delta, 0);
		expect(total).toBeCloseTo(159 - 125, 4);
	});

	it('shell charger: max stacks uses the 3-stack cap when falling back from custom magnitude data', () => {
		const standard = makeAmmo('standard', 'Standard', 1.0);
		const shellChargerEffect = makeEffect(
			'ShellChargerBuff',
			'ShellDamage',
			'AddBase',
			0,
			{ stackLimit: 3, magnitudeType: 'CustomCalculationClass' }
		);
		const shellCharger = makeComponent(
			'shell_charger',
			'SHELL CHARGER',
			['ShellChargerBuff'],
			[7.5],
			'Increases base Shell Damage by {LevelValue} whenever you penetrate an enemy. This effect can stack up to 3 times but falls off on a non-penetration.'
		);
		const vehicle = makeVehicle('test_tank', { ShellDamage: 125 }, 'standard', 'tree_test');
		const tree = makeTree('tree_test', 'test_tank', []);

		const bundle = makeBundle({
			vehicles: [vehicle],
			ammo: [standard],
			components: [shellCharger],
			talents: [],
			effects: [shellChargerEffect],
			trees: [tree]
		});
		const catalog = createPlannerCatalog(bundle);

		const build = computeBuild(
			catalog,
			{
				vehicleId: 'test_tank',
				ammoIds: ['standard'],
				previewAmmoSlot: 0,
				componentIds: ['shell_charger', '', '', ''],
				talentPoints: {}
			},
			{ assumeMaxStacks: true }
		);

		expect(build).not.toBeNull();
		expect(build!.stats.ShellDamage).toBeCloseTo(147.5, 4);
		const componentEntry = build!.breakdown.ShellDamage?.find((e) =>
			e.source.startsWith('Component:')
		);
		expect(componentEntry?.delta).toBeCloseTo(22.5, 4);
	});

	it('max health: percent buff applies to (base + Σflat), not just base (BULKHEADS case)', () => {
		// Replicates the screenshot from feedback: BULKHEADS +8.5% should multiply against
		// (base + flat talents + flat components), not only the base.
		//   Game:    (2050 + 100 + 200) × 1.085 = 2549.75
		//   Old bug: 2050 × 1.085 + 100 + 200    = 2524.25
		const standard = makeAmmo('standard', 'Standard', 1.0);
		const bulkheadsEffect = makeEffect('Bulkheads', 'MaxHealth', 'MultiplyAdditive', 1.085);
		const bulkheads = makeComponent('bulkheads', 'BULKHEADS', ['Bulkheads']);
		const surgerEffect = makeEffect('ModuleSurger', 'MaxHealth', 'AddBase', 100);
		const surger = makeComponent('module_surger', 'MODULE SURGER', ['ModuleSurger']);
		const maxHealthTalentEffect = makeEffect('MaxHealthTalent', 'MaxHealth', 'AddBase', 100);
		const maxHealthTalent = makeTalent('mh_talent', 'Max Health', ['MaxHealthTalent'], [100, 200]);
		const vehicle = makeVehicle('test_tank', { MaxHealth: 2050 }, 'standard', 'tree_test');
		const tree = makeTree('tree_test', 'test_tank', ['mh_talent']);

		const bundle = makeBundle({
			vehicles: [vehicle],
			ammo: [standard],
			components: [bulkheads, surger],
			talents: [maxHealthTalent],
			effects: [bulkheadsEffect, surgerEffect, maxHealthTalentEffect],
			trees: [tree]
		});
		const catalog = createPlannerCatalog(bundle);

		const selection: PlannerSelection = {
			vehicleId: 'test_tank',
			ammoIds: ['standard'],
			previewAmmoSlot: 0,
			componentIds: ['bulkheads', 'module_surger', '', ''],
			talentPoints: { mh_talent: 2 }
		};

		const build = computeBuild(catalog, selection);
		expect(build).not.toBeNull();
		expect(build!.stats.MaxHealth).toBeCloseTo(2549.75, 4);

		const breakdown = build!.breakdown.MaxHealth ?? [];
		const surgerEntry = breakdown.find((e) => e.source.includes('MODULE SURGER'));
		const talentEntry = breakdown.find((e) => e.source.includes('Max Health'));
		const bulkheadsEntry = breakdown.find((e) => e.source.includes('BULKHEADS'));

		// Flat sources show their literal value:
		expect(surgerEntry?.delta).toBeCloseTo(100, 4);
		expect(talentEntry?.delta).toBeCloseTo(200, 4);
		// Percent source is computed against (base + Σflat) = 2350, so 0.085 × 2350 = 199.75
		// (NOT 0.085 × 2050 = 174.25 like the old buggy display).
		expect(bulkheadsEntry?.delta).toBeCloseTo(199.75, 4);
	});

	it('multiple percent buffs on the same stat sum into one pool, never compound', () => {
		// Two +20% mults should combine to +40% (×1.40), not compound to ×1.44.
		const standard = makeAmmo('standard', 'Standard', 1.0);
		const eff1 = makeEffect('Pct1', 'ShellDamage', 'MultiplyAdditive', 1.2);
		const eff2 = makeEffect('Pct2', 'ShellDamage', 'MultiplyAdditive', 1.2);
		const c1 = makeComponent('c1', 'PCT_ONE', ['Pct1']);
		const c2 = makeComponent('c2', 'PCT_TWO', ['Pct2']);
		const vehicle = makeVehicle('test_tank', { ShellDamage: 100 }, 'standard', 'tree_test');
		const tree = makeTree('tree_test', 'test_tank', []);

		const bundle = makeBundle({
			vehicles: [vehicle],
			ammo: [standard],
			components: [c1, c2],
			talents: [],
			effects: [eff1, eff2],
			trees: [tree]
		});
		const catalog = createPlannerCatalog(bundle);

		const build = computeBuild(catalog, {
			vehicleId: 'test_tank',
			ammoIds: ['standard'],
			previewAmmoSlot: 0,
			componentIds: ['c1', 'c2', '', ''],
			talentPoints: {}
		});

		expect(build).not.toBeNull();
		// Game math: 100 × (1 + 0.20 + 0.20) = 140 (sum-pool)
		expect(build!.stats.ShellDamage).toBeCloseTo(140, 4);
		// Compound math (incorrect) would have given 100 × 1.20 × 1.20 = 144
		expect(build!.stats.ShellDamage).not.toBeCloseTo(144, 2);
	});

	it('ammo and aggregator percent stack correctly: flat-then-pct-then-ammo', () => {
		// HE shell ×1.20 + +20% talent should give ×1.20 (talent in pool, applied once) × ×1.20 (ammo on top).
		// On a base of 100 with no flats: 100 × 1.20 × 1.20 = 144.
		// If ammo were lumped into the same pool: 100 × (1 + 0.20 + 0.20) = 140 (wrong).
		const standard = makeAmmo('standard', 'Standard', 1.0);
		const he = makeAmmo('he', 'High Explosive', 1.2);
		const pctEff = makeEffect('Pct', 'ShellDamage', 'MultiplyAdditive', 1.2);
		const pctC = makeComponent('pct_c', 'PCT', ['Pct']);
		const vehicle = makeVehicle('test_tank', { ShellDamage: 100 }, 'standard', 'tree_test');
		const tree = makeTree('tree_test', 'test_tank', []);

		const bundle = makeBundle({
			vehicles: [vehicle],
			ammo: [standard, he],
			components: [pctC],
			talents: [],
			effects: [pctEff],
			trees: [tree]
		});
		const catalog = createPlannerCatalog(bundle);

		const build = computeBuild(catalog, {
			vehicleId: 'test_tank',
			ammoIds: ['he'],
			previewAmmoSlot: 0,
			componentIds: ['pct_c', '', '', ''],
			talentPoints: {}
		});

		expect(build).not.toBeNull();
		expect(build!.stats.ShellDamage).toBeCloseTo(144, 4);

		// Breakdown contributions sum to (final − base) = 44:
		const breakdown = build!.breakdown.ShellDamage ?? [];
		const total = breakdown.reduce((s, e) => s + e.delta, 0);
		expect(total).toBeCloseTo(44, 4);
	});

	it('a stat with no contributions is left unchanged', () => {
		const standard = makeAmmo('standard', 'Standard', 1.0);
		const vehicle = makeVehicle('test_tank', { ShellDamage: 100, MaxHealth: 1500 }, 'standard', 'tree_test');
		const tree = makeTree('tree_test', 'test_tank', []);

		const bundle = makeBundle({
			vehicles: [vehicle],
			ammo: [standard],
			components: [],
			talents: [],
			effects: [],
			trees: [tree]
		});
		const catalog = createPlannerCatalog(bundle);

		const build = computeBuild(catalog, {
			vehicleId: 'test_tank',
			ammoIds: ['standard'],
			previewAmmoSlot: 0,
			componentIds: ['', '', '', ''],
			talentPoints: {}
		});

		expect(build).not.toBeNull();
		expect(build!.stats.ShellDamage).toBeCloseTo(100, 4);
		expect(build!.stats.MaxHealth).toBeCloseTo(1500, 4);
		expect(build!.breakdown.ShellDamage ?? []).toHaveLength(0);
	});

	it('shell swap time talents do not modify intra-clip reload time', () => {
		const standard = makeAmmo('standard', 'Standard', 1.0);
		const shellSwapEffect = makeEffect('ShellSwapTime', 'ShellSwapTime', 'AddBase', -2.2);
		const shellSwapTalent = makeTalent(
			'brawler-talent001',
			'Shell Swap Time',
			['ShellSwapTime'],
			[-1.1, -2.2],
			2
		);
		const vehicle = makeVehicle(
			'brawler',
			{ IntraClipReloadTime: 4.5, ShellSwapTime: 4 },
			'standard',
			'tree_brawler'
		);
		const tree = makeTree('tree_brawler', 'brawler', ['brawler-talent001']);

		const bundle = makeBundle({
			vehicles: [vehicle],
			ammo: [standard],
			components: [],
			talents: [shellSwapTalent],
			effects: [shellSwapEffect],
			trees: [tree]
		});
		const catalog = createPlannerCatalog(bundle);

		const build = computeBuild(catalog, {
			vehicleId: 'brawler',
			ammoIds: ['standard'],
			previewAmmoSlot: 0,
			componentIds: ['', '', '', ''],
			talentPoints: { 'brawler-talent001': 2 }
		});

		expect(build).not.toBeNull();
		expect(build!.stats.IntraClipReloadTime).toBeCloseTo(4.5, 4);
		expect(build!.stats.ShellSwapTime).toBeCloseTo(1.8, 4);
		expect(build!.breakdown.IntraClipReloadTime ?? []).toHaveLength(0);
		expect(build!.breakdown.ShellSwapTime?.[0]?.delta).toBeCloseTo(-2.2, 4);
	});
});
