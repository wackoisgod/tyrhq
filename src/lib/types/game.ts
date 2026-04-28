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
	};
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
	modifiers: {
		damage: number;
		penetration: number;
		reload: number;
		dispersion: number;
		detection: number;
		velocity: number;
	};
};

export type ComponentSummary = {
	id: string;
	key: string;
	slug: string;
	name: string;
	description: string;
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
	modifiers: {
		damage: number;
		penetration: number;
		reload: number;
		dispersion: number;
		detection: number;
		velocity: number;
	};
	source: {
		key: string;
	};
};

export type EffectModifier = {
	attribute: string;
	op: string;
	magnitude: string;
	magnitudeType: string;
};

export type EffectRecord = {
	id: string;
	path: string;
	stackLimit: number;
	tags: string[];
	modifiers: EffectModifier[];
};

export type ComponentRecord = ComponentSummary & {
	tagIds: string[];
	eventTags: string[];
	effectIds: string[];
	effectPaths: string[];
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
