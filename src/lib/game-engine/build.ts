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

function applyModifierMode(stats: Record<string, number>, key: string, value: number, mode: string) {
	if (Number.isNaN(value)) return;

	if (stats[key] === undefined) {
		stats[key] = mode === 'mult' || mode === 'divide' ? 1 : 0;
	}

	if (mode === 'override') {
		stats[key] = value;
		return;
	}

	if (mode === 'divide') {
		if (value === 0) return;
		stats[key] = stats[key] / value;
		return;
	}

	if (mode === 'mult') {
		stats[key] = stats[key] * value;
		return;
	}

	stats[key] = stats[key] + value;
}

function applyModifierModeWithStacks(
	stats: Record<string, number>,
	key: string,
	value: number,
	mode: string,
	stacks = 1
) {
	const count = Math.max(1, Math.floor(stacks || 1));

	if (mode === 'override') {
		applyModifierMode(stats, key, value, mode);
		return;
	}

	if (mode === 'add') {
		applyModifierMode(stats, key, value * count, mode);
		return;
	}

	for (let index = 0; index < count; index += 1) {
		applyModifierMode(stats, key, value, mode);
	}
}

function getEffectName(effectPath = '') {
	const file = effectPath.split('/').at(-1) ?? '';
	return file.split('.')[0] ?? '';
}

function applyComponentEffect(
	stats: Record<string, number>,
	effectName: string,
	value: number,
	description: string,
	stackCount = 1
) {
	const mapping = componentEffectMappings.find((entry) => entry.pattern.test(effectName));
	if (!mapping) return false;

	const mode =
		/Percent/i.test(effectName) || /PercentMultiply/i.test(description)
			? 'mult'
			: (mapping.mode ?? 'add');
	const keys = mapping.keys ?? (mapping.key ? [mapping.key] : []);
	const effectiveValue = (mapping as { negate?: boolean }).negate ? -Math.abs(value) : value;

	for (const key of keys) {
		applyModifierModeWithStacks(stats, key, effectiveValue, mode, stackCount);
	}

	return keys.length > 0;
}

function applyDescriptionBasedComponentEffect(
	stats: Record<string, number>,
	component: ComponentRecord,
	stackCount = 1
) {
	const description = component.description || '';
	const targets = inferStatTargetsFromDescription(description);
	if (!targets.length) return false;

	let value = component.pointValues.at(-1) ?? 0;
	if (!value) return false;

	const mode = inferModeFromDescriptionText(description);
	if (mode === 'add' && descriptionIndicatesDecrease(description)) {
		value = -Math.abs(value);
	}

	if (mode === 'mult') {
		const increase = descriptionIndicatesIncrease(description);
		const decrease = descriptionIndicatesDecrease(description);
		if (increase && value < 1) value = 1 / value;
		if (decrease && value > 1) value = 1 / value;
	}

	for (const key of targets) {
		applyModifierModeWithStacks(stats, key, value, mode, stackCount);
	}

	return true;
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

function recordBreakdownDelta(
	breakdown: Record<string, BreakdownEntry[]>,
	beforeStats: Record<string, number>,
	afterStats: Record<string, number>,
	source: string,
	meta?: { conditional?: boolean }
) {
	const entryBase = meta?.conditional ? { conditional: true as const } : {};
	for (const stat of statDefinitions) {
		const beforeValue = beforeStats[stat.key] ?? (multiplierDefaultStats.has(stat.key) ? 1 : 0);
		const afterValue = afterStats[stat.key] ?? beforeValue;
		const delta = afterValue - beforeValue;
		if (Math.abs(delta) < 0.0001) continue;
		breakdown[stat.key] ??= [];
		breakdown[stat.key].push({ source, delta, ...entryBase });
	}
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
	const breakdown: Record<string, BreakdownEntry[]> = {};

	let currentStats = { ...baseStats };
	const previewAmmo = catalog.ammoById.get(selection.ammoIds[selection.previewAmmoSlot] ?? '') ?? null;

	if (previewAmmo) {
		const nextStats = { ...currentStats };
		nextStats.ShellDamage = (currentStats.ShellDamage ?? 0) * previewAmmo.modifiers.damage;
		nextStats.ShellPenetration = (currentStats.ShellPenetration ?? 0) * previewAmmo.modifiers.penetration;
		nextStats.ReloadTime = (currentStats.ReloadTime ?? 0) * previewAmmo.modifiers.reload;
		nextStats.IntraClipReloadTime = (currentStats.IntraClipReloadTime ?? 0) * previewAmmo.modifiers.reload;
		nextStats.BaseDispersionPenalty =
			(currentStats.BaseDispersionPenalty ?? 0) * previewAmmo.modifiers.dispersion;
		nextStats.MovementDispersionPenalty =
			(currentStats.MovementDispersionPenalty ?? 0) * previewAmmo.modifiers.dispersion;
		nextStats.HullTraverseDispersionPenalty =
			(currentStats.HullTraverseDispersionPenalty ?? 0) * previewAmmo.modifiers.dispersion;
		nextStats.TurretTraverseDispersionPenalty =
			(currentStats.TurretTraverseDispersionPenalty ?? 0) * previewAmmo.modifiers.dispersion;
		nextStats.FiringDispersionPenalty =
			(currentStats.FiringDispersionPenalty ?? 0) * previewAmmo.modifiers.dispersion;
		nextStats.DetectionRadius = (currentStats.DetectionRadius ?? 0) * previewAmmo.modifiers.detection;
		nextStats.ShellVelocity = (currentStats.ShellVelocity ?? 0) * previewAmmo.modifiers.velocity;

		recordBreakdownDelta(breakdown, currentStats, nextStats, `Ammo: ${previewAmmo.displayName}`);
		currentStats = nextStats;
	}

	for (const componentId of selection.componentIds) {
		if (!componentId) continue;
		const component = catalog.componentById.get(componentId);
		if (!component) continue;

		if (!includeConditionalEffects && isConditionalComponent(component)) {
			continue;
		}

		const description = component.description || '';
		const allowsStacking = descriptionIndicatesStacking(description);
		const nextStats = { ...currentStats };
		let applied = false;

		for (const effectId of [...new Set(component.effectIds)]) {
			const effect = catalog.effectById.get(effectId);
			if (!effect) continue;
			const effectName = getEffectName(effect.path);
			if (!effectName || /(Remover|Tracker|Trigger|Applier)/i.test(effectName)) continue;

			let effectApplied = false;
			for (const modifier of effect.modifiers) {
				const attribute = normalizeAttributeKey(modifier.attribute);
				if (!attribute || !statKeySet.has(attribute)) continue;
				const value = getModifierValue(modifier);
				if (value === null) continue;

				applyModifierModeWithStacks(
					nextStats,
					attribute,
					value,
					getModifierModeFromOp(modifier.op),
					getEventStackCount(effect, assumeMaxStacks && allowsStacking)
				);
				effectApplied = true;
			}

			if (!effectApplied) {
				const value = component.pointValues.at(-1) ?? 0;
				if (
					applyComponentEffect(
						nextStats,
						effectName,
						value,
						description,
						getEventStackCount(effect, assumeMaxStacks && allowsStacking)
					)
				) {
					effectApplied = true;
				}
			}

			applied ||= effectApplied;
		}

		if (!applied) {
			applyDescriptionBasedComponentEffect(
				nextStats,
				component,
				assumeMaxStacks && allowsStacking ? 2 : 1
			);
		}

		recordBreakdownDelta(breakdown, currentStats, nextStats, `Component: ${component.name}`, {
			conditional: isConditionalComponent(component)
		});
		currentStats = nextStats;
	}

	for (const [talentId, points] of Object.entries(selection.talentPoints)) {
		if (points <= 0) continue;
		const talent = catalog.talentById.get(talentId);
		if (!talent) continue;
		if (!includeConditionalEffects && isConditionalTalent(talent)) continue;

		const value = getTalentPointValue(talent, points);
		if (!value || Number.isNaN(value)) continue;

		const nextStats = { ...currentStats };
		const allowMaxStacks = assumeMaxStacks && descriptionIndicatesStacking(talent.description);

		for (const effectId of [...new Set(talent.effectIds)]) {
			const effect = catalog.effectById.get(effectId);
			if (!effect) continue;
			for (const modifier of effect.modifiers) {
				const attribute = normalizeAttributeKey(modifier.attribute);
				if (!attribute || !statKeySet.has(attribute)) continue;
				applyModifierModeWithStacks(
					nextStats,
					attribute,
					value,
					getModifierModeFromOp(modifier.op),
					getEventStackCount(effect, allowMaxStacks)
				);
			}
		}

		recordBreakdownDelta(breakdown, currentStats, nextStats, `Talent: ${talent.name} (${points})`, {
			conditional: isConditionalTalent(talent)
		});
		currentStats = nextStats;
	}

	return {
		vehicle,
		previewAmmo,
		stats: currentStats,
		baseStats,
		breakdown,
		statCards: statDefinitions.map((definition) => {
			const base = baseStats[definition.key] ?? (multiplierDefaultStats.has(definition.key) ? 1 : 0);
			const value = currentStats[definition.key] ?? base;
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
