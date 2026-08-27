export type ArmorHitResult =
	| 'penetrate'
	| 'ricochet'
	| 'no_pen'
	| 'overmatch'
	| 'fifty_fifty'
	| 'module'
	| 'absorb';

export type ArmorModuleInfo = {
	id: number;
	name: string;
	moduleType: string;
	moduleTypeLabel: string;
	moduleTypeTag: string;
	moduleIdentifierTag: string;
	requiresPenetration: boolean;
};

export type ArmorData = {
	vehicleId: string;
	textureWidth: number;
	textureHeight: number;
	triangles: [number, number][];
	isModule: number[];
	isAbsorb?: number[];
	moduleIds?: number[];
	modules?: Record<string, ArmorModuleInfo>;
	sectionIds?: number[];
};

export type ArmorHitInfo = {
	thickness: number;
	angle: number;
	isFiftyFifty: boolean;
	result: ArmorHitResult;
	module?: ArmorModuleInfo;
};

export function getArmorModuleForTriangle(data: ArmorData, triangleIndex: number) {
	const moduleId = data.moduleIds?.[triangleIndex];
	if (!moduleId) return undefined;
	return data.modules?.[String(moduleId)];
}

export function getArmorModuleLabel(module: ArmorModuleInfo | undefined) {
	const label = module?.moduleTypeLabel?.trim();
	return label && label.toLowerCase() !== 'unknown' ? label : undefined;
}
