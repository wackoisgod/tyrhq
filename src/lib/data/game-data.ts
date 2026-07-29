import runtimeData from '$gamedata/generated/runtime.json';

import {
	fillGeneratedComponentDescription,
	type ComponentValueToken
} from '$lib/game-engine/component-format';
import { compareStatKeys } from '$lib/game-engine/tank-compare';
import type {
	AmmoSummary,
	CompareTank,
	ComponentSummary,
	GameDataBundle,
	GameSnapshot,
	MapSummary,
	TalentSummary,
	TalentTreeSummary,
	TankSummary
} from '$lib/types/game';

type RawGameDataBundle = Omit<GameDataBundle, 'ammo'> & {
	ammo: Array<Omit<GameDataBundle['ammo'][number], 'displayName'> & { displayName?: string }>;
};

/**
 * The runtime bundle flattens component description placeholders (e.g. {LevelValuePercent},
 * {LevelValueAbs}) to the literal word "value", losing how the point value must be scaled
 * for display. This map restores each component's placeholder token from the raw
 * ComponentData drop. Components absent here use plain `LevelValue` (raw number) semantics.
 * `component-tokens.test.ts` asserts this map stays in sync with the raw data.
 */
export const componentValueTokens = new Map<string, ComponentValueToken>([
	['adaptivehardening', 'LevelValuePercent'],
	['agitator', 'LevelValuePercentMultiplyIncrease'],
	['bulkheads', 'LevelValuePercentMultiplyIncrease'],
	['camoweb', 'LevelValuePercentMultiplyIncrease'],
	['coreinjector', 'LevelValuePercentMultiplyDecrease'],
	['driftsparker', 'LevelValuePercentMultiplyIncrease'],
	['energyexpander', 'LevelValuePercentMultiplyIncrease'],
	['extendedgearing', 'LevelValuePercentMultiplyIncrease'],
	['hotchamber', 'LevelValuePercentMultiplyIncrease'],
	['kineticabsorber', 'LevelValueAbs'],
	['phasemodule', 'LevelValueAbs'],
	['powerconverter', 'LevelValuePercentMultiplyDecrease'],
	['quickslot', 'LevelValuePercentMultiplyDecrease'],
	['reactivemodules', 'LevelValuePercent'],
	['repairmechanism', 'LevelValuePercentMultiplyDecrease'],
	['sensitivesights', 'LevelValuePercentMultiplyIncrease'],
	['signatureobscurer', 'LevelValueAbs'],
	['stablerangefinder', 'LevelValuePercentMultiplyDecrease'],
	['synchronizer', 'LevelValuePercentMultiplyIncrease'],
	['vulnbreaker', 'LevelValuePercent'],
	['weaknessanalyzer', 'LevelValueAbs']
]);

function deriveAmmoDisplayName(key: string, fallbackName: string) {
	const rawName = key.split('.').at(-1) ?? fallbackName;
	return rawName
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.trim();
}

function normalizeComponentDescription(component: GameDataBundle['components'][number]) {
	return fillGeneratedComponentDescription(
		component.description,
		component.pointValues,
		componentValueTokens.get(component.id)
	);
}

function normalizeBundle(rawBundle: GameDataBundle): GameDataBundle {
	return {
		...rawBundle,
		ammo: rawBundle.ammo.map((ammo) => ({
			...ammo,
			displayName: ammo.displayName || deriveAmmoDisplayName(ammo.key, ammo.name)
		})),
		components: rawBundle.components.map((component) => ({
			...component,
			description: normalizeComponentDescription(component)
		}))
	};
}

const bundle = normalizeBundle(runtimeData as RawGameDataBundle as GameDataBundle);

function toTankSummary(): TankSummary[] {
	return bundle.vehicles.map((vehicle) => ({
		id: vehicle.id,
		key: vehicle.key,
		slug: vehicle.slug,
		name: vehicle.name,
		classId: vehicle.classId,
		classLabel: vehicle.classLabel,
		isWorkInProgress: Boolean(vehicle.isWorkInProgress),
		selectable: vehicle.selectable,
		stats: {
			health: Number(vehicle.stats.MaxHealth ?? 0),
			maxSpeed: Number(vehicle.stats.MaxSpeed ?? 0),
			reverseSpeed: Number(vehicle.stats.MaxReverseSpeed ?? 0),
			reloadTime: Number(vehicle.stats.ReloadTime ?? 0),
			damage: Number(vehicle.stats.ShellDamage ?? 0),
			penetration: Number(vehicle.stats.ShellPenetration ?? 0),
			vision: Number(vehicle.stats.VisionRadius ?? 0),
			detection: Number(vehicle.stats.DetectionRadius ?? 0),
			camo: Number(vehicle.stats.CamoPercentage ?? 0),
			difficulty: Number(vehicle.stats.DifficultyRating ?? 0)
		},
		ability: vehicle.ability
	}));
}

function toAmmoSummary(): AmmoSummary[] {
	return bundle.ammo.map((ammo) => ({
		id: ammo.id,
		key: ammo.key,
		slug: ammo.slug,
		name: ammo.name,
		displayName: ammo.displayName,
		description: ammo.description,
		selectable: ammo.selectable,
		canLoadSecondary: ammo.canLoadSecondary,
		modifiers: ammo.modifiers
	}));
}

function toComponentSummary(): ComponentSummary[] {
	return bundle.components.map((component) => ({
		id: component.id,
		key: component.key,
		slug: component.slug,
		name: component.name,
		description: component.description,
		categoryId: component.categoryId,
		category: component.category,
		pointValues: component.pointValues
	}));
}

function toTalentSummary(): TalentSummary[] {
	return bundle.talents.map((talent) => ({
		id: talent.id,
		key: talent.key,
		slug: talent.slug,
		name: talent.name,
		description: talent.description,
		maxPoints: talent.maxPoints
	}));
}

function toTalentTreeSummary(): TalentTreeSummary[] {
	return bundle.talentTrees.map((tree) => ({
		id: tree.id,
		slug: tree.slug,
		name: tree.name,
		vehicleId: tree.vehicleId,
		talentCount: tree.talentCount
	}));
}

function toMapSummary(): MapSummary[] {
	return (bundle.maps ?? []).map((map) => ({
		id: map.id,
		slug: map.slug,
		name: map.name,
		displayName: map.displayName,
		status: map.status
	}));
}

export function getGameDataBundle() {
	return bundle;
}

export function getCompareTanks(): CompareTank[] {
	return bundle.vehicles.map((vehicle) => ({
		id: vehicle.id,
		slug: vehicle.slug,
		name: vehicle.name,
		classId: vehicle.classId,
		classLabel: vehicle.classLabel,
		isWorkInProgress: Boolean(vehicle.isWorkInProgress),
		stats: Object.fromEntries(
			compareStatKeys.map((key) => [key, Number(vehicle.stats[key] ?? 0)])
		),
		ability: vehicle.ability
	}));
}

export function getGameSnapshot(): GameSnapshot {
	return {
		tanks: toTankSummary(),
		ammo: toAmmoSummary(),
		components: toComponentSummary(),
		talents: toTalentSummary(),
		talentTrees: toTalentTreeSummary(),
		maps: toMapSummary(),
		lastGeneratedAt: bundle.metadata.generatedAt
	};
}
