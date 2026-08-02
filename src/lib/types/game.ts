import type { ComponentValueToken, TalentValueToken } from '$lib/game-engine/component-format';

export type VehicleAbility = {
	name: string;
	description: string;
	icon: string;
};

export type TankSummary = {
	id: string;
	key: string;
	slug: string;
	name: string;
	classId: string;
	classLabel: string;
	isWorkInProgress: boolean;
	selectable: boolean;
	stats: {
		health: number;
		maxSpeed: number;
		reverseSpeed: number;
		reloadTime: number;
		damage: number;
		penetration: number;
		vision: number;
		detection: number;
		camo: number;
		difficulty: number;
	};
	ability: VehicleAbility;
};

/**
 * Payload for the vehicle comparison tool: identity plus the raw stat subset
 * from `compareStatKeys` (see `$lib/game-engine/tank-compare`).
 */
export type CompareTank = {
	id: string;
	slug: string;
	name: string;
	classId: string;
	classLabel: string;
	isWorkInProgress: boolean;
	stats: Record<string, number>;
	ability: VehicleAbility;
};

export type AmmoSummary = {
	id: string;
	key: string;
	slug: string;
	name: string;
	displayName: string;
	description: string;
	selectable: boolean;
	canLoadSecondary: boolean;
	modifiers: AmmoModifiers;
};

// Shell modifiers (always present) plus optional while-loaded vehicle-speed
// modifiers, which only exist for ammo whose equip effect alters movement
// (e.g. Lightweight/Mobility raises speed, Unstable restricts it).
export type AmmoModifiers = {
	damage: number;
	penetration: number;
	reload: number;
	dispersion: number;
	detection: number;
	velocity: number;
	maxSpeed?: number;
	reverseSpeed?: number;
	strafeSpeed?: number;
};

export type ComponentSummary = {
	id: string;
	key: string;
	slug: string;
	name: string;
	description: string;
	descriptionTemplate?: string;
	valueTokens?: ComponentValueToken[];
	categoryId: string;
	category: string;
	pointValues: number[];
};

export type TalentSummary = {
	id: string;
	key: string;
	slug: string;
	name: string;
	description: string;
	descriptionTemplate?: string;
	valueTokens?: TalentValueToken[];
	maxPoints: number;
};

export type TalentTreeSummary = {
	id: string;
	slug: string;
	name: string;
	vehicleId: string;
	talentCount: number;
};

export type NativeComponentEntry = {
	componentId: string;
	level: number;
};

export type NativeVehicleEntry = {
	vehicleId: string;
	level: number;
};

export type VehicleRecord = {
	id: string;
	key: string;
	slug: string;
	name: string;
	classId: string;
	classLabel: string;
	isWorkInProgress: boolean;
	selectable: boolean;
	stats: Record<string, number>;
	ability: VehicleAbility;
	loadout: {
		componentSlotCount: number;
		ammoSlotCount: number;
		defaultAmmoIds: string[];
		previewAmmoSlot: number;
		talentTreeId: string;
	};
	nativeComponents: NativeComponentEntry[];
	source: {
		tankKey: string;
		vehicleUiKey: string;
	};
};

export type AmmoRecord = AmmoSummary & {
	modifiers: AmmoModifiers;
	source: {
		key: string;
	};
};

export type EffectModifier = {
	attribute: string;
	attributeSet?: string;
	op: string;
	magnitude: string;
	magnitudeType: string;
	calculationClass?: string;
	scalableFloatValue?: number | null;
};

export type EffectBinding = {
	eventTag: string;
	effectId: string;
	effectPath: string;
};

export type EffectTagRequirement = {
	requiredTags: string[];
	ignoredTags: string[];
	tagQuery: unknown;
};

export type EffectRecord = {
	id: string;
	path: string;
	durationPolicy?: string;
	durationMagnitude?: string;
	period?: string;
	chanceToApply?: string;
	stackingType?: string;
	stackLimit: number;
	stackDurationRefreshPolicy?: string;
	stackPeriodResetPolicy?: string;
	tags: string[];
	ownedTags?: string[];
	removeEffectsWithTags?: string[];
	tagRequirements?: Record<'application' | 'ongoing' | 'removal', EffectTagRequirement>;
	modifiers: EffectModifier[];
	executions?: unknown[];
	gameplayCues?: unknown[];
};

export type ComponentRecord = ComponentSummary & {
	tagIds: string[];
	eventTags: string[];
	effectIds: string[];
	effectPaths: string[];
	effectBindings?: EffectBinding[];
	nativeVehicles: NativeVehicleEntry[];
	source: {
		key: string;
	};
};

export type TalentRecord = TalentSummary & {
	supplementalDescription: string;
	icon: string;
	type: string;
	eventTags: string[];
	effectIds: string[];
	effectPaths: string[];
	effectBindings?: EffectBinding[];
	pointValues: number[];
	source: {
		key: string;
	};
};

export type TalentTreeNode = {
	talentId: string;
	tier: number;
	row: number;
	maxPoints: number;
	isKeystone: boolean;
	prerequisiteIds: string[];
};

export type TalentTreeRecord = TalentTreeSummary & {
	version: number;
	nodes: TalentTreeNode[];
	source: {
		file: string;
	};
};

export type MapSummary = {
	id: string;
	slug: string;
	name: string;
	displayName: string;
	status: 'released' | 'prototype' | 'testmap';
};

export type MapRecord = MapSummary & {
	source: {
		key: string;
		minimapTexture: string;
		lobbyTexture: string;
	};
};

export type GameDataBundle = {
	metadata: {
		schemaVersion: number;
		generatedAt: string;
		rawSource: string;
		sourceChangelist?: number | null;
		sourceRevisionPolicy?: string;
		exporter?: {
			revision?: number | null;
			changelist?: number | null;
		};
	};
	vehicles: VehicleRecord[];
	ammo: AmmoRecord[];
	components: ComponentRecord[];
	talents: TalentRecord[];
	talentTrees: TalentTreeRecord[];
	effects: EffectRecord[];
	maps: MapRecord[];
};

export type GameSnapshot = {
	tanks: TankSummary[];
	ammo: AmmoSummary[];
	components: ComponentSummary[];
	talents: TalentSummary[];
	talentTrees: TalentTreeSummary[];
	maps: MapSummary[];
	lastGeneratedAt: string;
};
