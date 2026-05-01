import type {
	AmmoRecord,
	ComponentRecord,
	EffectRecord,
	GameDataBundle,
	TalentRecord,
	TalentTreeRecord,
	VehicleRecord
} from '$lib/types/game';
import {
	lowerBetterStats,
	multiplierDefaultStats,
	statDefinitionByKey,
	statDefinitions,
	statKeySet,
	type StatDefinition
} from '$lib/game-engine/stat-definitions';

/** Global cap on talent points spendable across the whole tree (game rule). */
export const MAX_TOTAL_TALENT_POINTS = 31;

/**
 * TyrPilotBuilderSite / prototype: each tier index T requires 5×T points spent in *lower* tiers
 * before any node on tier T can receive points.
 */
export const TALENT_POINTS_REQUIRED_PER_TIER_STEP = 5;

/** Points that must be spent in tiers &lt; `tier` before spending on this tier (prototype: tier * 5). */
export function getTalentTierUnlockRequirement(tier: number): number {
	return Math.max(0, tier) * TALENT_POINTS_REQUIRED_PER_TIER_STEP;
}

/** Sum points on all nodes strictly below `tier` (matches TyrPilotBuilderSite `getPointsSpentBeforeTier`). */
export function getPointsSpentInTiersBelow(
	nodes: PlannerTalentNode[],
	talentPoints: Record<string, number>,
	tier: number
): number {
	let total = 0;
	for (const node of nodes) {
		if (node.tier >= tier) continue;
		total += talentPoints[node.talent.id] ?? 0;
	}
	return total;
}

/** Every prerequisite talent must be fully maxed out before this talent can receive points. */
export function talentPrerequisitesSatisfied(
	node: PlannerTalentNode,
	talentPoints: Record<string, number>,
	allNodes?: PlannerTalentNode[]
): boolean {
	return node.prerequisiteIds.every((id) => {
		const pts = talentPoints[id] ?? 0;
		if (!allNodes) return pts > 0;
		const prereqNode = allNodes.find((n) => n.talent.id === id);
		return prereqNode ? pts >= prereqNode.maxPoints : pts > 0;
	});
}

/** Whether one more point can be added on this node under prototype UI rules. */
export function canIncrementTalentPoint(
	node: PlannerTalentNode,
	allNodes: PlannerTalentNode[],
	talentPoints: Record<string, number>,
	currentPoints: number,
	maxPoints: number,
	totalSpent: number
): boolean {
	if (currentPoints >= maxPoints) return false;
	if (totalSpent >= MAX_TOTAL_TALENT_POINTS) return false;
	if (!talentPrerequisitesSatisfied(node, talentPoints, allNodes)) return false;
	const spentBelow = getPointsSpentInTiersBelow(allNodes, talentPoints, node.tier);
	if (spentBelow < getTalentTierUnlockRequirement(node.tier)) return false;
	return true;
}

export type PlannerSelection = {
	vehicleId: string;
	ammoIds: string[];
	previewAmmoSlot: number;
	componentIds: string[];
	talentPoints: Record<string, number>;
};

export type PlannerCatalog = {
	vehicles: VehicleRecord[];
	ammo: AmmoRecord[];
	components: ComponentRecord[];
	effects: EffectRecord[];
	vehicleById: Map<string, VehicleRecord>;
	ammoById: Map<string, AmmoRecord>;
	componentById: Map<string, ComponentRecord>;
	talentById: Map<string, TalentRecord>;
	effectById: Map<string, EffectRecord>;
	talentTreeById: Map<string, TalentTreeRecord>;
};

export type PlannerTalentNode = {
	talent: TalentRecord;
	tier: number;
	row: number;
	maxPoints: number;
	isKeystone: boolean;
	prerequisiteIds: string[];
};

export type BreakdownEntry = {
	source: string;
	delta: number;
	/** True when the contribution is context-dependent (talents: see isConditionalTalent; components: see isConditionalComponent). */
	conditional?: boolean;
};

export type ComputedBuild = {
	vehicle: VehicleRecord;
	previewAmmo: AmmoRecord | null;
	stats: Record<string, number>;
	baseStats: Record<string, number>;
	breakdown: Record<string, BreakdownEntry[]>;
	statCards: Array<{
		definition: StatDefinition;
		base: number;
		value: number;
		delta: number;
	}>;
};

const attributeAliasMap = new Map([['ShellSwapTime', 'IntraClipReloadTime']]);

const componentEffectMappings = [
	{ pattern: /MaxAndStartingEnergyMultiply/i, key: 'MaxAbilityResource', mode: 'mult' },
	{ pattern: /MaxHealthPercent/i, key: 'MaxHealth', mode: 'mult' },
	{ pattern: /MaxHealthFlat/i, key: 'MaxHealth', mode: 'add' },
	{ pattern: /MaxSpeedAndMaxReverseSpeedPercent/i, keys: ['MaxSpeed', 'MaxReverseSpeed'], mode: 'mult' },
	{ pattern: /MaxSpeedPercent/i, key: 'MaxSpeed', mode: 'mult' },
	{ pattern: /MaxSpeedFlat/i, key: 'MaxSpeed', mode: 'add' },
	{ pattern: /MaxReverseSpeedPercent/i, key: 'MaxReverseSpeed', mode: 'mult' },
	{ pattern: /MaxReverseSpeedFlat/i, key: 'MaxReverseSpeed', mode: 'add' },
	{ pattern: /HullTraverse/i, key: 'HullTraverseSpeed', mode: 'add' },
	{ pattern: /TurretTraverse/i, key: 'TurretTraverseSpeed', mode: 'add' },
	{ pattern: /GunTraverse/i, key: 'GunTraverseSpeed', mode: 'add' },
	{ pattern: /ShellDamagePercent/i, key: 'ShellDamage', mode: 'mult' },
	{ pattern: /ShellDamageFlat|DuplicatorShellDamage/i, key: 'ShellDamage', mode: 'add' },
	{ pattern: /ShellVelocity/i, key: 'ShellVelocity', mode: 'add' },
	{ pattern: /ShellPenetration/i, key: 'ShellPenetration', mode: 'add' },
	{ pattern: /ReloadTimePercent/i, key: 'ReloadTime', mode: 'mult' },
	{ pattern: /ReloadTime/i, key: 'ReloadTime', mode: 'add' },
	{ pattern: /Intra.*Reload/i, key: 'IntraClipReloadTime', mode: 'add' },
	{ pattern: /AbilityCooldown(?:Reduction)/i, key: 'AbilityCooldown', mode: 'add', negate: true },
	{ pattern: /AbilityCooldown/i, key: 'AbilityCooldown', mode: 'add' },
	{ pattern: /(?<!HealFor)AbilityCost|EnergyCost/i, key: 'AbilityCost', mode: 'mult' },
	{ pattern: /AimSpeed|DispersionReduction/i, key: 'DispersionReductionSpeed', mode: 'add' },
	{ pattern: /BaseAimingDispersion|BaseDispersion/i, key: 'BaseDispersionPenalty', mode: 'mult' },
	{ pattern: /MovementDispersion/i, key: 'MovementDispersionPenalty', mode: 'mult' },
	{ pattern: /HullTraverseDispersion/i, key: 'HullTraverseDispersionPenalty', mode: 'mult' },
	{ pattern: /TurretTraverseDispersion/i, key: 'TurretTraverseDispersionPenalty', mode: 'mult' },
	{ pattern: /FiringDispersion/i, key: 'FiringDispersionPenalty', mode: 'mult' },
	{ pattern: /VisionRadius/i, key: 'VisionRadius', mode: 'add' },
	{ pattern: /DetectionRadius/i, key: 'DetectionRadius', mode: 'add' }
];

const descriptionStatMappings = [
	{ pattern: /shell damage/, key: 'ShellDamage' },
	{ pattern: /penetration/, key: 'ShellPenetration' },
	{ pattern: /reload time/, key: 'ReloadTime' },
	{ pattern: /intra.*reload|intra-?clip/, key: 'IntraClipReloadTime' },
	{ pattern: /clip size/, key: 'ClipSize' },
	{ pattern: /shell velocity|velocity/, key: 'ShellVelocity' },
	{ pattern: /base dispersion|aiming dispersion/, key: 'BaseDispersionPenalty' },
	{ pattern: /movement dispersion/, key: 'MovementDispersionPenalty' },
	{ pattern: /hull traverse dispersion/, key: 'HullTraverseDispersionPenalty' },
	{ pattern: /turret traverse dispersion/, key: 'TurretTraverseDispersionPenalty' },
	{ pattern: /firing dispersion/, key: 'FiringDispersionPenalty' },
	{ pattern: /aim speed|aiming speed|dispersion reduction/, key: 'DispersionReductionSpeed' },
	{ pattern: /max health|health/, key: 'MaxHealth' },
	{ pattern: /max reverse speed|reverse speed/, key: 'MaxReverseSpeed' },
	{ pattern: /max speed/, key: 'MaxSpeed' },
	{ pattern: /hull traverse speed/, key: 'HullTraverseSpeed' },
	{ pattern: /turret traverse speed/, key: 'TurretTraverseSpeed' },
	{ pattern: /gun traverse speed/, key: 'GunTraverseSpeed' },
	{ pattern: /vision radius|vision/, key: 'VisionRadius' },
	{ pattern: /detection radius|detection/, key: 'DetectionRadius' },
	{ pattern: /ability cooldown|cooldown/, key: 'AbilityCooldown' },
	{ pattern: /ability cost|energy cost/, key: 'AbilityCost' },
	{ pattern: /max energy|maximum energy/, key: 'MaxAbilityResource' },
	{ pattern: /starting energy|initial energy/, key: 'InitialAbilityResource' },
	{ pattern: /active reload/, key: 'ActiveReloadReductionTime' }
];

function normalizeAttributeKey(attribute?: string) {
	if (!attribute) return '';
	return attributeAliasMap.get(attribute) || attribute;
}

function normalizeDescription(text: string) {
	return text
		.replace(/<[^>]*>/g, ' ')
		.replace(/\{[^}]*\}/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

function descriptionIndicatesDecrease(description: string) {
	return /reduce|reduces|reduced|decrease|decreases|decreased|lower|lowers|shorten|shortens|faster|speed up|speeds up/.test(
		normalizeDescription(description)
	);
}

function descriptionIndicatesIncrease(description: string) {
	return /increase|increases|increased|boost|boosts|gain|gains|raise|raises|higher/.test(
		normalizeDescription(description)
	);
}

export function descriptionIndicatesStacking(description: string) {
	return /stack|stacks|stacking/.test(normalizeDescription(description));
}

function inferStatTargetsFromDescription(description: string) {
	const normalized = normalizeDescription(description);
	const targets = new Set<string>();

	for (const mapping of descriptionStatMappings) {
		if (mapping.pattern.test(normalized)) {
			targets.add(mapping.key);
		}
	}

	return [...targets];
}

function inferModeFromDescriptionText(description: string) {
	const normalized = normalizeDescription(description);
	const hasExplicitMultiplier =
		/percent|%|multiply|multipl|x\d/.test(normalized) ||
		(/\b\d+(\.\d+)?\s*times\b/.test(normalized) && !/stack/.test(normalized));

	if (hasExplicitMultiplier || /\{levelvaluepercent/i.test(description)) {
		return 'mult';
	}

	return 'add';
}

function getModifierModeFromOp(op?: string) {
	const normalized = (op || '').toLowerCase();
	if (normalized.includes('override')) return 'override';
	if (normalized.includes('divide')) return 'divide';
	if (normalized.includes('multiply')) return 'mult';
	return 'add';
}

function extractScalableFloatValue(magnitudeText?: string) {
	if (!magnitudeText) return null;
	const match = magnitudeText.match(/ScalableFloatMagnitude=\(Value=([+-]?[0-9]*\.?[0-9]+)/i);
	if (!match) return null;
	const value = Number(match[1]);
	return Number.isFinite(value) ? value : null;
}

function getModifierValue(modifier: EffectRecord['modifiers'][number]) {
	const magnitudeType = modifier.magnitudeType.toLowerCase();
	if (magnitudeType && magnitudeType !== 'scalablefloat') return null;
	return extractScalableFloatValue(modifier.magnitude);
}

type ContributionMode = 'add' | 'mult' | 'divide' | 'override';

/**
 * One stored modifier contribution, keyed to a single attribute.
 *
 * Stored `value` semantics depend on `mode`:
 *  - `add`:      flat amount, already × stack count
 *  - `mult`:     fraction relative to base, already × stack count (e.g. 0.05 for +5%)
 *  - `divide`:   raw divisor value (one entry per stack — sequential, marginal)
 *  - `override`: target value (last override wins)
 */
type Contribution = {
	source: string;
	attribute: string;
	value: number;
	mode: ContributionMode;
	conditional: boolean;
	order: number;
};

/**
 * Per-shot ammo multiplier — applied AFTER aggregator math, since ammo lives outside the
 * GAS attribute aggregator in-engine (the projectile reads vehicle ShellDamage and multiplies
 * by `Shell.DamageModifier`).
 */
type AmmoContribution = {
	source: string;
	attribute: string;
	/** Multiplier form, e.g. 1.20 for HE +20% shell damage. */
	multiplier: number;
	order: number;
};

type EffectEdit = {
	attribute: string;
	value: number;
	mode: ContributionMode;
	stacks: number;
};

function pushContribution(
	list: Contribution[],
	edit: EffectEdit,
	source: string,
	conditional: boolean,
	order: number
) {
	const { attribute, value, mode, stacks } = edit;
	if (Number.isNaN(value)) return;
	const count = Math.max(1, Math.floor(stacks || 1));

	if (mode === 'override') {
		list.push({ source, attribute, value, mode, conditional, order });
		return;
	}

	if (mode === 'add') {
		list.push({ source, attribute, value: value * count, mode, conditional, order });
		return;
	}

	if (mode === 'divide') {
		// Divides are rare; preserve compound sequential semantics (one entry per stack).
		for (let index = 0; index < count; index += 1) {
			list.push({ source, attribute, value, mode, conditional, order });
		}
		return;
	}

	// mode === 'mult' — engine semantics: each stack adds (value − 1) to the multiplicitive
	// pool. We store the post-stack fraction directly so resolution can sum across sources.
	const stackedFraction = (value - 1) * count;
	list.push({ source, attribute, value: stackedFraction, mode, conditional, order });
}

function getEffectName(effectPath = '') {
	const file = effectPath.split('/').at(-1) ?? '';
	return file.split('.')[0] ?? '';
}

function getComponentEffectEdits(
	effectName: string,
	value: number,
	description: string,
	stackCount = 1
): EffectEdit[] {
	const mapping = componentEffectMappings.find((entry) => entry.pattern.test(effectName));
	if (!mapping) return [];

	const inferredMode =
		/Percent/i.test(effectName) || /PercentMultiply/i.test(description)
			? 'mult'
			: (mapping.mode ?? 'add');
	const mode: ContributionMode =
		inferredMode === 'mult' || inferredMode === 'divide' || inferredMode === 'override'
			? (inferredMode as ContributionMode)
			: 'add';
	const keys = mapping.keys ?? (mapping.key ? [mapping.key] : []);
	const effectiveValue = (mapping as { negate?: boolean }).negate ? -Math.abs(value) : value;

	return keys.map((key) => ({ attribute: key, value: effectiveValue, mode, stacks: stackCount }));
}

function getDescriptionBasedComponentEdits(
	component: ComponentRecord,
	stackCount = 1
): EffectEdit[] {
	const description = component.description || '';
	const targets = inferStatTargetsFromDescription(description);
	if (!targets.length) return [];

	let value = component.pointValues.at(-1) ?? 0;
	if (!value) return [];

	const inferredMode = inferModeFromDescriptionText(description);
	const mode: ContributionMode = inferredMode === 'mult' ? 'mult' : 'add';
	if (mode === 'add' && descriptionIndicatesDecrease(description)) {
		value = -Math.abs(value);
	}

	if (mode === 'mult') {
		const increase = descriptionIndicatesIncrease(description);
		const decrease = descriptionIndicatesDecrease(description);
		if (increase && value < 1) value = 1 / value;
		if (decrease && value > 1) value = 1 / value;
	}

	return targets.map((key) => ({ attribute: key, value, mode, stacks: stackCount }));
}

/**
 * Resolve all contributions for a single stat into a final value plus per-source breakdown.
 *
 * Math matches the in-engine GAS aggregator:
 *   resolved = ((base + Σadds) × (1 + Σmult_fractions)) ÷ Πdivides
 *   final    = resolved × ammoMultiplier   (ammo is a per-shot multiplier, not aggregator-resident)
 *
 * Per-source breakdown contributions:
 *   add source:       its flat value
 *   mult source:      fraction × (base + Σadds)
 *   divide source:    marginal (sequential, since divides are rare)
 *   ammo:             resolved × (ammoMultiplier − 1)
 *
 * These sum to (final − base), so the breakdown is always self-consistent with the displayed total.
 */
function resolveStat(
	base: number,
	contribs: Contribution[],
	ammo: AmmoContribution | undefined
): { value: number; entries: BreakdownEntry[] } {
	const sourceGroups = new Map<
		string,
		{ delta: number; conditional: boolean; minOrder: number }
	>();

	const accumulate = (source: string, conditional: boolean, order: number, delta: number) => {
		if (!Number.isFinite(delta)) return;
		const existing = sourceGroups.get(source);
		if (existing) {
			existing.delta += delta;
			existing.conditional = existing.conditional || conditional;
			existing.minOrder = Math.min(existing.minOrder, order);
		} else {
			sourceGroups.set(source, { delta, conditional, minOrder: order });
		}
	};

	const buildEntries = (): BreakdownEntry[] =>
		[...sourceGroups.entries()]
			.filter(([, group]) => Math.abs(group.delta) >= 0.0001)
			.sort(([, a], [, b]) => a.minOrder - b.minOrder)
			.map(([source, group]) => ({
				source,
				delta: group.delta,
				...(group.conditional ? { conditional: true as const } : {})
			}));

	// Override wins entirely. Last override applied is the winner (matches engine "last writer").
	const overrides = contribs.filter((c) => c.mode === 'override');
	if (overrides.length > 0) {
		const winner = overrides[overrides.length - 1];
		let value = winner.value;
		accumulate(winner.source, winner.conditional, winner.order, winner.value - base);
		if (ammo) {
			value *= ammo.multiplier;
			accumulate(ammo.source, false, ammo.order, winner.value * (ammo.multiplier - 1));
		}
		return { value, entries: buildEntries() };
	}

	const adds = contribs.filter((c) => c.mode === 'add');
	const mults = contribs.filter((c) => c.mode === 'mult');
	const divides = contribs.filter((c) => c.mode === 'divide');

	const sumFlat = adds.reduce((sum, c) => sum + c.value, 0);
	const sumPct = mults.reduce((sum, c) => sum + c.value, 0);
	const flatAdjustedBase = base + sumFlat;
	let aggregator = flatAdjustedBase * (1 + sumPct);

	for (const c of adds) {
		accumulate(c.source, c.conditional, c.order, c.value);
	}
	for (const c of mults) {
		accumulate(c.source, c.conditional, c.order, c.value * flatAdjustedBase);
	}

	// Divides applied sequentially (rare path).
	for (const c of divides) {
		if (c.value === 0) continue;
		const before = aggregator;
		aggregator = aggregator / c.value;
		accumulate(c.source, c.conditional, c.order, aggregator - before);
	}

	let final = aggregator;
	if (ammo) {
		final = aggregator * ammo.multiplier;
		accumulate(ammo.source, false, ammo.order, aggregator * (ammo.multiplier - 1));
	}

	return { value: final, entries: buildEntries() };
}

function getEventStackCount(effect: EffectRecord | undefined, allowMaxStacks: boolean) {
	if (!allowMaxStacks) return 1;
	return effect?.stackLimit && effect.stackLimit > 1 ? effect.stackLimit : 1;
}

function getTalentPointValue(talent: TalentRecord, points: number) {
	const clampedPoints = Math.min(Math.max(points, 1), talent.pointValues.length);
	return talent.pointValues[clampedPoints - 1] ?? 0;
}

/**
 * Event tags that only mean "apply when loadout is applied" in UE — not player-situational bonuses.
 * Almost all talents carry `Gameplay.Event.LoadoutApplied`, so we must not treat that alone as conditional.
 */
const BASELINE_TALENT_EVENT_TAGS = new Set<string>(['Gameplay.Event.LoadoutApplied']);

function normalizeDescriptionForConditionalHeuristic(raw: string): string {
	return raw
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/**
 * Shared TyrPilotBuilder-style wording: when/while, narrow "on …", after …, if you/….
 * Operates on HTML-stripped, lowercased text.
 */
function descriptionSuggestsSituationalContext(normalizedDesc: string): boolean {
	if (!normalizedDesc) return false;

	if (/\bwhen\b|\bwhile\b|\bwhenever\b/.test(normalizedDesc)) return true;
	if (
		/\bon\s+(hits?|kill|kills|hit|penetration|reload|reloads|ability|abilities|cast|damage|destroy|destroyed|death|combat|fire|firing|spot|spotted|landing|use)\b/.test(
			normalizedDesc
		)
	)
		return true;
	if (/\bafter\b/.test(normalizedDesc)) return true;
	if (/\bif\s+(you|your|the|it|enemy|this|below)\b/.test(normalizedDesc)) return true;
	if (/\bbouncing\b|\bbounce\b|\beach time\b|\beach second\b/.test(normalizedDesc)) return true;
	if (/\b(firing|repairing|damaging|using)\s+(a|an|your|alternate|the|enemy)\b/.test(normalizedDesc)) return true;
	if (/\bfalls off\b|\bresets on\b/.test(normalizedDesc)) return true;
	return false;
}

/**
 * True when a talent is context-dependent (TyrPilotBuilder-style): non-baseline event tags and/or
 * situational wording in the description. Used for Sources badge and the Conditionals toggle.
 */
export function isConditionalTalent(talent: TalentRecord): boolean {
	const situationalTags = talent.eventTags.filter((tag) => !BASELINE_TALENT_EVENT_TAGS.has(tag));
	if (situationalTags.length > 0) return true;

	const desc = normalizeDescriptionForConditionalHeuristic(
		`${talent.description ?? ''} ${talent.supplementalDescription ?? ''}`
	);
	return descriptionSuggestsSituationalContext(desc);
}

/**
 * Components are conditional when their event tags include non-baseline events (e.g. WhileUnSpotted,
 * OnBounce), or when the description uses situational wording as a heuristic fallback.
 */
export function isConditionalComponent(component: ComponentRecord): boolean {
	const situationalTags = (component.eventTags ?? []).filter(
		(tag) => !BASELINE_TALENT_EVENT_TAGS.has(tag)
	);
	if (situationalTags.length > 0) return true;
	const desc = normalizeDescriptionForConditionalHeuristic(component.description ?? '');
	return descriptionSuggestsSituationalContext(desc);
}

export function createPlannerCatalog(bundle: GameDataBundle): PlannerCatalog {
	const selectableAmmo = bundle.ammo.filter((ammo) => ammo.id === 'standard' || ammo.selectable);

	return {
		vehicles: bundle.vehicles,
		ammo: selectableAmmo,
		components: bundle.components,
		effects: bundle.effects,
		vehicleById: new Map(bundle.vehicles.map((vehicle) => [vehicle.id, vehicle])),
		ammoById: new Map(selectableAmmo.map((ammo) => [ammo.id, ammo])),
		componentById: new Map(bundle.components.map((component) => [component.id, component])),
		talentById: new Map(bundle.talents.map((talent) => [talent.id, talent])),
		effectById: new Map(bundle.effects.map((effect) => [effect.id, effect])),
		talentTreeById: new Map(bundle.talentTrees.map((tree) => [tree.id, tree]))
	};
}

export function getPlannerTalentsForVehicle(catalog: PlannerCatalog, vehicleId: string): PlannerTalentNode[] {
	const tree = catalog.talentTreeById.get(vehicleId);
	if (!tree) return [];

	return tree.nodes
		.map((node) => {
			const talent = catalog.talentById.get(node.talentId);
			if (!talent) return null;
			return {
				talent,
				tier: node.tier,
				row: node.row,
				maxPoints: node.maxPoints,
				isKeystone: node.isKeystone,
				prerequisiteIds: node.prerequisiteIds
			};
		})
		.filter((value): value is PlannerTalentNode => Boolean(value))
		.sort((left, right) => left.tier - right.tier || left.row - right.row);
}

export function getDefaultSelection(catalog: PlannerCatalog, vehicleId?: string): PlannerSelection {
	const vehicle = vehicleId
		? catalog.vehicleById.get(vehicleId)
		: catalog.vehicles[0];
	const targetVehicle = vehicle ?? catalog.vehicles[0];

	return {
		vehicleId: targetVehicle.id,
		ammoIds: [...targetVehicle.loadout.defaultAmmoIds],
		previewAmmoSlot: targetVehicle.loadout.previewAmmoSlot,
		componentIds: Array.from({ length: targetVehicle.loadout.componentSlotCount }, () => ''),
		talentPoints: {}
	};
}

/**
 * Compute a build's resolved stats and per-source breakdown.
 *
 * Aggregator math (matches in-engine GAS aggregator):
 *   resolved = ((base + Σadds) × (1 + Σmult_fractions)) ÷ Πdivides
 *
 * Aggregator-resident sources:
 *   - components (passive + situational)
 *   - talents
 *
 * Per-shot multiplier (applied AFTER aggregator):
 *   - the previewed ammo (one shell's `DamageModifier` etc. per affected stat)
 *
 * This split matters when more than one percent buff hits the same stat: aggregator percents
 * SUM into a single pool (`+5% + +10% = +15%`, applied once), while ammo multiplies on top
 * (so HE's `×1.20` and a `+15%` talent give `×1.20 × 1.15`, not `×1.35`).
 */
export function computeBuild(
	catalog: PlannerCatalog,
	selection: PlannerSelection,
	options: { includeConditionalEffects?: boolean; assumeMaxStacks?: boolean } = {}
): ComputedBuild | null {
	const vehicle = catalog.vehicleById.get(selection.vehicleId);
	if (!vehicle) return null;

	const includeConditionalEffects = options.includeConditionalEffects ?? true;
	const assumeMaxStacks = options.assumeMaxStacks ?? false;
	const baseStats = { ...vehicle.stats };

	const contributions: Contribution[] = [];
	const ammoContribs: AmmoContribution[] = [];
	let order = 0;

	const previewAmmo =
		catalog.ammoById.get(selection.ammoIds[selection.previewAmmoSlot] ?? '') ?? null;

	if (previewAmmo) {
		const ammoSource = `Ammo: ${previewAmmo.displayName}`;
		const m = previewAmmo.modifiers;
		const ammoTargets: Array<[string, number]> = [
			['ShellDamage', m.damage],
			['ShellPenetration', m.penetration],
			['ReloadTime', m.reload],
			['IntraClipReloadTime', m.reload],
			['BaseDispersionPenalty', m.dispersion],
			['MovementDispersionPenalty', m.dispersion],
			['HullTraverseDispersionPenalty', m.dispersion],
			['TurretTraverseDispersionPenalty', m.dispersion],
			['FiringDispersionPenalty', m.dispersion],
			['DetectionRadius', m.detection],
			['ShellVelocity', m.velocity]
		];
		for (const [attribute, multiplier] of ammoTargets) {
			if (!Number.isFinite(multiplier) || multiplier === 1) continue;
			ammoContribs.push({ source: ammoSource, attribute, multiplier, order: order++ });
		}
	}

	for (const componentId of selection.componentIds) {
		if (!componentId) continue;
		const component = catalog.componentById.get(componentId);
		if (!component) continue;
		if (!includeConditionalEffects && isConditionalComponent(component)) continue;

		const description = component.description || '';
		const allowsStacking = descriptionIndicatesStacking(description);
		const conditional = isConditionalComponent(component);
		const source = `Component: ${component.name}`;
		let appliedAny = false;

		for (const effectId of [...new Set(component.effectIds)]) {
			const effect = catalog.effectById.get(effectId);
			if (!effect) continue;
			const effectName = getEffectName(effect.path);
			if (!effectName || /(Remover|Tracker|Trigger|Applier)/i.test(effectName)) continue;

			const stackCount = getEventStackCount(effect, assumeMaxStacks && allowsStacking);
			let effectApplied = false;

			for (const modifier of effect.modifiers) {
				const attribute = normalizeAttributeKey(modifier.attribute);
				if (!attribute || !statKeySet.has(attribute)) continue;
				const value = getModifierValue(modifier);
				if (value === null) continue;

				const mode = getModifierModeFromOp(modifier.op) as ContributionMode;
				pushContribution(
					contributions,
					{ attribute, value, mode, stacks: stackCount },
					source,
					conditional,
					order++
				);
				effectApplied = true;
			}

			if (!effectApplied) {
				const fallbackValue = component.pointValues.at(-1) ?? 0;
				const edits = getComponentEffectEdits(effectName, fallbackValue, description, stackCount);
				for (const edit of edits) {
					pushContribution(contributions, edit, source, conditional, order++);
					effectApplied = true;
				}
			}

			appliedAny ||= effectApplied;
		}

		if (!appliedAny) {
			const fallbackStacks = assumeMaxStacks && allowsStacking ? 2 : 1;
			const edits = getDescriptionBasedComponentEdits(component, fallbackStacks);
			for (const edit of edits) {
				pushContribution(contributions, edit, source, conditional, order++);
			}
		}
	}

	for (const [talentId, points] of Object.entries(selection.talentPoints)) {
		if (points <= 0) continue;
		const talent = catalog.talentById.get(talentId);
		if (!talent) continue;
		if (!includeConditionalEffects && isConditionalTalent(talent)) continue;

		const value = getTalentPointValue(talent, points);
		if (!value || Number.isNaN(value)) continue;

		const conditional = isConditionalTalent(talent);
		const source = `Talent: ${talent.name} (${points})`;
		const allowMaxStacks = assumeMaxStacks && descriptionIndicatesStacking(talent.description);

		for (const effectId of [...new Set(talent.effectIds)]) {
			const effect = catalog.effectById.get(effectId);
			if (!effect) continue;
			const stackCount = getEventStackCount(effect, allowMaxStacks);
			for (const modifier of effect.modifiers) {
				const attribute = normalizeAttributeKey(modifier.attribute);
				if (!attribute || !statKeySet.has(attribute)) continue;
				const mode = getModifierModeFromOp(modifier.op) as ContributionMode;
				pushContribution(
					contributions,
					{ attribute, value, mode, stacks: stackCount },
					source,
					conditional,
					order++
				);
			}
		}
	}

	const finalStats: Record<string, number> = { ...baseStats };
	const breakdown: Record<string, BreakdownEntry[]> = {};

	const contribsByAttr = new Map<string, Contribution[]>();
	for (const c of contributions) {
		const list = contribsByAttr.get(c.attribute);
		if (list) list.push(c);
		else contribsByAttr.set(c.attribute, [c]);
	}
	const ammoByAttr = new Map<string, AmmoContribution>();
	for (const a of ammoContribs) ammoByAttr.set(a.attribute, a);

	for (const stat of statDefinitions) {
		const key = stat.key;
		const statContribs = contribsByAttr.get(key) ?? [];
		const statAmmo = ammoByAttr.get(key);
		if (statContribs.length === 0 && !statAmmo) continue;

		const baseValue = baseStats[key] ?? (multiplierDefaultStats.has(key) ? 1 : 0);
		const { value, entries } = resolveStat(baseValue, statContribs, statAmmo);
		finalStats[key] = value;
		if (entries.length > 0) breakdown[key] = entries;
	}

	return {
		vehicle,
		previewAmmo,
		stats: finalStats,
		baseStats,
		breakdown,
		statCards: statDefinitions.map((definition) => {
			const base = baseStats[definition.key] ?? (multiplierDefaultStats.has(definition.key) ? 1 : 0);
			const value = finalStats[definition.key] ?? base;
			return {
				definition,
				base,
				value,
				delta: value - base
			};
		})
	};
}

export function formatStatValue(value: number, unit?: string) {
	if (!Number.isFinite(value)) return '-';
	const rounded = Math.abs(value - Math.round(value)) < 0.0001 ? String(Math.round(value)) : value.toFixed(2);
	return unit ? `${rounded} ${unit}` : rounded;
}

export function getDeltaTone(definition: StatDefinition, delta: number) {
	if (Math.abs(delta) < 0.0001) return 'neutral';
	if (definition.lowerBetter) return delta < 0 ? 'positive' : 'negative';
	return delta > 0 ? 'positive' : 'negative';
}

export function groupStatCards(cards: ComputedBuild['statCards']) {
	const grouped = new Map<string, ComputedBuild['statCards']>();

	for (const card of cards) {
		const group = grouped.get(card.definition.group) ?? [];
		group.push(card);
		grouped.set(card.definition.group, group);
	}

	return [...grouped.entries()];
}
