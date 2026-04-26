export type StatDefinition = {
	key: string;
	label: string;
	group: string;
	unit?: string;
	lowerBetter?: boolean;
};

export const statDefinitions: StatDefinition[] = [
	{ key: 'ShellDamage', label: 'Damage', group: 'Weapon' },
	{ key: 'ShellPenetration', label: 'Penetration', group: 'Weapon' },
	{ key: 'ReloadTime', label: 'Reload Time', group: 'Weapon', unit: 's', lowerBetter: true },
	{ key: 'IntraClipReloadTime', label: 'Intra Reload', group: 'Weapon', unit: 's', lowerBetter: true },
	{ key: 'ShellVelocity', label: 'Shell Velocity', group: 'Weapon', unit: 'm/s' },
	{
		key: 'BaseDispersionPenalty',
		label: 'Base Dispersion',
		group: 'Dispersion',
		lowerBetter: true
	},
	{
		key: 'MovementDispersionPenalty',
		label: 'Move Dispersion',
		group: 'Dispersion',
		lowerBetter: true
	},
	{
		key: 'HullTraverseDispersionPenalty',
		label: 'Hull Dispersion',
		group: 'Dispersion',
		lowerBetter: true
	},
	{
		key: 'TurretTraverseDispersionPenalty',
		label: 'Turret Dispersion',
		group: 'Dispersion',
		lowerBetter: true
	},
	{
		key: 'FiringDispersionPenalty',
		label: 'Firing Dispersion',
		group: 'Dispersion',
		lowerBetter: true
	},
	{ key: 'DispersionReductionSpeed', label: 'Aim Speed', group: 'Dispersion' },
	{ key: 'MaxHealth', label: 'Health', group: 'Survivability' },
	{ key: 'MaxSpeed', label: 'Top Speed', group: 'Mobility', unit: 'kph' },
	{ key: 'MaxReverseSpeed', label: 'Reverse Speed', group: 'Mobility', unit: 'kph' },
	{ key: 'HullTraverseSpeed', label: 'Hull Traverse', group: 'Mobility', unit: 'deg/s' },
	{ key: 'TurretTraverseSpeed', label: 'Turret Traverse', group: 'Mobility', unit: 'deg/s' },
	{ key: 'GunTraverseSpeed', label: 'Gun Traverse', group: 'Mobility', unit: 'deg/s' },
	{ key: 'MaxStrafingSpeed', label: 'Strafing Speed', group: 'Mobility', unit: 'kph' },
	{ key: 'AccelerationTime', label: 'Acceleration', group: 'Mobility', unit: 's', lowerBetter: true },
	{ key: 'VisionRadius', label: 'Vision', group: 'Vision', unit: 'm' },
	{ key: 'DetectionRadius', label: 'Detection', group: 'Vision', unit: 'm' },
	{ key: 'CamoPercentage', label: 'Camo', group: 'Vision', unit: '%' },
	{ key: 'MaxAbilityResource', label: 'Max Energy', group: 'Ability' },
	{ key: 'InitialAbilityResource', label: 'Starting Energy', group: 'Ability' },
	{ key: 'AbilityCooldown', label: 'Ability Cooldown', group: 'Ability', unit: 's', lowerBetter: true },
	{ key: 'AbilityCost', label: 'Ability Cost', group: 'Ability', lowerBetter: true },
	{
		key: 'ActiveReloadReductionTime',
		label: 'Active Reload Reduction',
		group: 'Ability',
		unit: 's'
	},
	{ key: 'WallPhaseInTime', label: 'Wall Phase Time', group: 'Ability', unit: 's', lowerBetter: true }
];

export const statDefinitionByKey = new Map(statDefinitions.map((stat) => [stat.key, stat]));
export const statKeySet = new Set(statDefinitions.map((stat) => stat.key));

export const lowerBetterStats = new Set(
	statDefinitions.filter((stat) => stat.lowerBetter).map((stat) => stat.key)
);

export const multiplierDefaultStats = new Set([
	'AccelerationTime',
	'CaptureZoneShellsGainedMultiplier',
	'DamageBlockedAssistModifier',
	'DamageBlockedModifier',
	'DamageDealtModifier',
	'DamageTakenModifier',
	'DownforceMultiplier',
	'DronePlacementRange',
	'ModuleRepairTimeMultiplier',
	'RecallZoneScale',
	'ShotRevealMultiplier',
	'SlowZoneAbilitySize',
	'SpottingAssistModifier',
	'TrackModuleDamagedAssistModifier'
]);
