import { describe, expect, it } from 'vitest';

import { getGameDataBundle } from '$lib/data/game-data';
import {
	createPlannerCatalog,
	getDefaultSelection,
	getPlannerTalentsForVehicle
} from '$lib/game-engine/build';

import {
	decodeLoadoutShareCode,
	exportPlannerSelectionToShareCode,
	importShareCodeToPlannerSelection
} from './loadout-sharing';

const catalog = createPlannerCatalog(getGameDataBundle());

describe('loadout sharing', () => {
	it('roundtrips a planner selection into a Tyr share code', () => {
		const vehicle = catalog.vehicleById.get('stealth') ?? catalog.vehicles[0];
		const selection = getDefaultSelection(catalog, vehicle.id);
		const components = catalog.components.slice(0, Math.min(selection.componentIds.length, 2));
		const altAmmo = catalog.ammo.find((entry) => entry.id !== 'standard' && entry.canLoadSecondary);
		const talentNodes = getPlannerTalentsForVehicle(catalog, vehicle.id);

		components.forEach((component, index) => {
			selection.componentIds[index] = component.id;
		});

		if (altAmmo && selection.ammoIds.length > 1) {
			selection.ammoIds[1] = altAmmo.id;
		}

		if (talentNodes[0]) {
			selection.talentPoints[talentNodes[0].talent.id] = Math.min(1, talentNodes[0].maxPoints);
		}

		const shareCode = exportPlannerSelectionToShareCode(selection, 'Stealth Trial');
		const decoded = decodeLoadoutShareCode(shareCode);

		expect(shareCode.startsWith('TYR01_')).toBe(true);
		expect(decoded.vehicleTag).toBe(vehicle.key);
		expect(decoded.name).toBe('Stealth Trial');
		expect(decoded.index).toBe(0);
		expect(decoded.components).toHaveLength(selection.componentIds.length);
		expect(decoded.components[0]).toBe(components[0]?.key ?? '');
		expect(decoded.ammoSlots).toHaveLength(selection.ammoIds.length);
		expect(decoded.ammoSlots[1]).toBe(altAmmo?.key ?? catalog.ammoById.get(selection.ammoIds[1])?.key);
		expect(decoded.techTree.vehicleTag).toBe(vehicle.key);
		expect(decoded.techTree.name).toBe('Stealth Trial');
		expect(decoded.techTree.version).toBeGreaterThan(0);
		expect(decoded.techTree.allocations).toEqual(
			talentNodes[0]
				? [{ talentTag: talentNodes[0].talent.key, pointsAllocated: 1 }]
				: []
		);
	});

	it('decodes the known game-side regression sample share code', () => {
		const shareCode =
			'TYR01_JQEAAHicfc89CsJAEAXgQTtPkM6fxm7BI6j4gxgQkfSbdUgGZ3eWzUbMob2D0SoWyYOp3jfFSwDgoC161o3KsCTDqK5oNDOM227W7bdivTh0sVJZzW4TUD8wwLzHpGSCXFhHcgVMe9Be54GMjhJg1JJll62trR1FEqdujUd1pKLcvTxLRU-ExRBNJSem2MA3k_bOou9Sx9kKkoHJ__J9-r3DB8bbWXk';

		const decoded = decodeLoadoutShareCode(shareCode);

		expect(decoded.vehicleTag.length).toBeGreaterThan(0);
		expect(decoded.components).toHaveLength(3);
		expect(decoded.ammoSlots).toHaveLength(2);
		expect(decoded.techTree.allocations).toHaveLength(0);
	});

	it('imports a share code back into the same planner selection', () => {
		const vehicle = catalog.vehicleById.get('stealth') ?? catalog.vehicles[0];
		const selection = getDefaultSelection(catalog, vehicle.id);
		selection.componentIds[0] = catalog.components[0].id;
		const talentNode = getPlannerTalentsForVehicle(catalog, vehicle.id)[0];
		if (talentNode) selection.talentPoints[talentNode.talent.id] = 1;

		const imported = importShareCodeToPlannerSelection(
			`  ${exportPlannerSelectionToShareCode(selection, 'Round Trip')}\n`
		);

		expect(imported.name).toBe('Round Trip');
		expect(imported.warnings).toEqual([]);
		expect(imported.selection).toEqual(selection);
	});

	it('imports the game-side sample share code', () => {
		const imported = importShareCodeToPlannerSelection(
			'TYR01_JQEAAHicfc89CsJAEAXgQTtPkM6fxm7BI6j4gxgQkfSbdUgGZ3eWzUbMob2D0SoWyYOp3jfFSwDgoC161o3KsCTDqK5oNDOM227W7bdivTh0sVJZzW4TUD8wwLzHpGSCXFhHcgVMe9Be54GMjhJg1JJll62trR1FEqdujUd1pKLcvTxLRU-ExRBNJSem2MA3k_bOou9Sx9kKkoHJ__J9-r3DB8bbWXk'
		);

		// In-game codes carry NUL-terminated strings; the tags must still resolve.
		expect(imported.selection.vehicleId).toBe('recall');
		expect(imported.selection.componentIds).toEqual(['vulnbreaker', 'microplating', 'fabricator']);
		expect(imported.selection.ammoIds[0]).toBe('highexplosive');
		expect(imported.name).toBe('Loadout 1');
	});

	it('rejects text that is not a share code', () => {
		expect(() => importShareCodeToPlannerSelection('hello')).toThrow(/valid Tyr share code/);
		expect(() => importShareCodeToPlannerSelection('TYR01_AAAA')).toThrow(/valid Tyr share code/);
	});
});
