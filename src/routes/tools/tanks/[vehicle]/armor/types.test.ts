import { describe, expect, it } from 'vitest';

import {
	getArmorModuleForTriangle,
	getArmorModuleLabel,
	type ArmorData,
	type ArmorModuleInfo
} from './types';

const engineModule: ArmorModuleInfo = {
	id: 56470,
	name: 'SK_Test_Armor_56470',
	moduleType: 'engine',
	moduleTypeLabel: 'Engine',
	moduleTypeTag: 'Gameplay.ModuleType.Engine',
	moduleIdentifierTag: 'Gameplay.Module.Engine',
	requiresPenetration: true
};

function makeArmorData(): ArmorData {
	return {
		vehicleId: 'test',
		textureWidth: 1,
		textureHeight: 1,
		triangles: [[0, 0]],
		isModule: [1],
		moduleIds: [engineModule.id],
		modules: { [engineModule.id]: engineModule }
	};
}

describe('armor module metadata', () => {
	it('resolves the exported module for a hovered triangle', () => {
		expect(getArmorModuleForTriangle(makeArmorData(), 0)).toEqual(engineModule);
		expect(getArmorModuleLabel(engineModule)).toBe('Engine');
	});

	it('falls back cleanly for old or unresolved armor data', () => {
		const legacyData = { ...makeArmorData(), moduleIds: undefined, modules: undefined };
		const unknownModule = { ...engineModule, moduleType: 'unknown', moduleTypeLabel: 'Unknown' };

		expect(getArmorModuleForTriangle(legacyData, 0)).toBeUndefined();
		expect(getArmorModuleLabel(unknownModule)).toBeUndefined();
	});
});
