import runtimeData from '$gamedata/generated/runtime.json';

import type {
	AmmoSummary,
	ComponentSummary,
	GameDataBundle,
	GameSnapshot,
	MapSummary,
	TalentSummary,
	TalentTreeSummary,
	TankSummary
} from '$lib/types/game';

const bundle = runtimeData as GameDataBundle;

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
			camo: Number(vehicle.stats.CamoPercentage ?? 0)
		}
	}));
}

function toAmmoSummary(): AmmoSummary[] {
	return bundle.ammo.map((ammo) => ({
		id: ammo.id,
		key: ammo.key,
		slug: ammo.slug,
		name: ammo.name,
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
