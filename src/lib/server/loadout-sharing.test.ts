import { describe, expect, it } from 'vitest';
import { deflateSync, inflateSync } from 'node:zlib';

import { getGameDataBundle } from '$lib/data/game-data';
import {
	createPlannerCatalog,
	getDefaultSelection,
	getPlannerTalentsForVehicle
} from '$lib/game-engine/build';

import {
	decodeLoadoutShareCode,
	exportPlannerSelectionToShareCode,
	importShareCodeToPlannerSelection,
	type SharedVehicleLoadout
} from './loadout-sharing';

const catalog = createPlannerCatalog(getGameDataBundle());

const GAME_SHARE_CODE =
	'TYR01_JQEAAHicfc89CsJAEAXgQTtPkM6fxm7BI6j4gxgQkfSbdUgGZ3eWzUbMob2D0SoWyYOp3jfFSwDgoC161o3KsCTDqK5oNDOM227W7bdivTh0sVJZzW4TUD8wwLzHpGSCXFhHcgVMe9Be54GMjhJg1JJll62trR1FEqdujUd1pKLcvTxLRU-ExRBNJSem2MA3k_bOou9Sx9kKkoHJ__J9-r3DB8bbWXk';

// Independent fixture packed with Python struct/zlib using UE's signed FString lengths.
const UNICODE_GAME_FORMAT_SHARE_CODE =
	'TYR01_CwEAAHick2BgYHBPzE0tyEms1AtLzchMzknVC0pNTszJYWBmYGBQQJZ3zs8tyM9LzSsp1gsrzclzKkpNzE4tYoABJgYGBhVk9Y65uaV5mSWZ-Xl6IZUFqXruiUXpiXklpYl5DPL41PmkpiZngI388P___5MMyQw5DIkMmQxFDAoMU9T4_ykwpIV7Byow2N5ouMfAIIHHC8Tof-sFcT8An2VRbA';
const UNICODE_NAME = 'Éclair ⚔️ 坦克 🚀';

// Captured from the website before its FString/slot fixes: no terminators, three ammo slots.
const LEGACY_WEBSITE_SHARE_CODE =
	'TYR01_BwEAAHicfc-9CsIwFAXgC-6u3fzBPe-gDgXpVKXO1_TQBpObkKZDHtp3kKJDQexdzwfn3IKISnYIlrNq0BttoWpotnZFRNt5fPYueIGkQTWjlVMEPxHpexPfz_nRuVFMMl7ULQeoa2JpObaHJVRy7FjSyLJZYhWg-6l1TUQVOtZ5d8djMAnF_49-8evyGf8GpatPew';

// Read exports independently of the website decoder, following SerializeLoadoutBinary
// and FArchive's FString operator (Core/Private/Containers/String.cpp.inl).
function readShareCodeAsGame(shareCode: string): SharedVehicleLoadout {
	expect(shareCode.slice(0, 6)).toBe('TYR01_');
	const compressed = Buffer.from(shareCode.slice(6), 'base64url');
	const payload = inflateSync(compressed.subarray(4));
	expect(payload.length).toBe(compressed.readInt32LE(0));
	let offset = 0;
	function readInt32() {
		const value = payload.readInt32LE(offset);
		offset += 4;
		return value;
	}
	function readFString() {
		const length = readInt32();
		if (length === 0) return '';
		const unicode = length < 0;
		const charSize = unicode ? 2 : 1;
		const bytes = payload.subarray(offset, offset + Math.abs(length) * charSize);
		offset += bytes.length;
		// UE overwrites the final code unit with NUL, which used to truncate website names.
		expect(unicode ? bytes.readUInt16LE(bytes.length - 2) : bytes.at(-1)).toBe(0);
		return bytes.subarray(0, -charSize).toString(unicode ? 'utf16le' : 'latin1');
	}
	function readTags() {
		return Array.from({ length: readInt32() }, readFString);
	}
	const vehicleTag = readFString();
	const components = readTags();
	const ammoSlots = readTags();
	const index = readInt32();
	const name = readFString();
	const techTree = {
		vehicleTag: readFString(),
		name: readFString(),
		version: readInt32(),
		allocations: Array.from({ length: readInt32() }, () => ({
			talentTag: readFString(),
			pointsAllocated: readInt32()
		}))
	};
	expect(offset).toBe(payload.length);
	return { vehicleTag, components, ammoSlots, index, name, techTree };
}

describe('loadout sharing', () => {
	it('exports the game binary layout, including components, ammo and talents', () => {
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
		const decoded = readShareCodeAsGame(shareCode);

		expect(shareCode.startsWith('TYR01_')).toBe(true);
		expect(decoded.vehicleTag).toBe(vehicle.key);
		expect(decoded.name).toBe('Stealth Trial');
		expect(decoded.index).toBe(0);
		expect(decoded.components).toHaveLength(selection.componentIds.length);
		expect(decoded.components).toEqual(
			selection.componentIds.map((id) => catalog.componentById.get(id)?.key ?? '')
		);
		expect(decoded.ammoSlots).toEqual([
			catalog.ammoById.get(selection.ammoIds[1])?.key,
			catalog.ammoById.get(selection.ammoIds[2])?.key
		]);
		expect(decoded.techTree.vehicleTag).toBe(vehicle.key);
		expect(decoded.techTree.name).toBe('Stealth Trial');
		expect(decoded.techTree.version).toBeGreaterThan(0);
		expect(decoded.techTree.allocations).toEqual(
			talentNodes[0]
				? [{ talentTag: talentNodes[0].talent.key, pointsAllocated: 1 }]
				: []
		);
	});

	it.each(['Stealth Trial', 'A', 'Éclair', 'Blink 坦克 🚀'])(
		'preserves the complete name %j when read with the game string format',
		(name) => {
			const selection = getDefaultSelection(catalog, 'recall');
			const decoded = readShareCodeAsGame(exportPlannerSelectionToShareCode(selection, name));
			expect(decoded.name).toBe(name);
			expect(decoded.techTree.name).toBe(name);
		}
	);

	it('decodes the known game-side regression sample share code', () => {
		const decoded = decodeLoadoutShareCode(GAME_SHARE_CODE);

		expect(readShareCodeAsGame(GAME_SHARE_CODE)).toEqual(decoded);
		expect(decoded.vehicleTag).toBe('Gameplay.Vehicle.Recall');
		expect(decoded.components).toHaveLength(3);
		expect(decoded.ammoSlots).toHaveLength(2);
		expect(decoded.techTree.allocations).toHaveLength(0);
	});

	it('imports a share code back into the same planner selection', () => {
		const vehicle = catalog.vehicleById.get('stealth') ?? catalog.vehicles[0];
		const selection = getDefaultSelection(catalog, vehicle.id);
		selection.componentIds[0] = catalog.components[0].id;
		selection.ammoIds = ['standard', 'gargantuan', 'leech'];
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
		const imported = importShareCodeToPlannerSelection(GAME_SHARE_CODE);

		// In-game codes carry NUL-terminated strings; the tags must still resolve.
		expect(imported.selection.vehicleId).toBe('recall');
		expect(imported.selection.componentIds).toEqual(['vulnbreaker', 'microplating', 'fabricator']);
		expect(imported.selection.ammoIds).toEqual(['standard', 'highexplosive', 'mobility']);
		expect(imported.warnings).toEqual([]);
		expect(imported.name).toBe('Loadout 1');
	});

	it('imports game-format UTF-16 names and keeps Siphon in the tertiary slot', () => {
		expect(readShareCodeAsGame(UNICODE_GAME_FORMAT_SHARE_CODE).name).toBe(UNICODE_NAME);
		const imported = importShareCodeToPlannerSelection(UNICODE_GAME_FORMAT_SHARE_CODE);
		expect(imported.name).toBe(UNICODE_NAME);
		expect(imported.selection.componentIds).toEqual(['vulnbreaker', '', '']);
		expect(imported.selection.ammoIds).toEqual(['standard', 'gargantuan', 'leech']);
		expect(imported.warnings).toEqual([]);
	});

	it('imports old website codes with three ammo slots and unterminated strings', () => {
		const imported = importShareCodeToPlannerSelection(LEGACY_WEBSITE_SHARE_CODE);
		expect(imported.name).toBe('Legacy Website');
		expect(imported.selection.componentIds).toEqual(['vulnbreaker', '', '']);
		expect(imported.selection.ammoIds).toEqual(['standard', 'gargantuan', 'leech']);
		expect(imported.warnings).toEqual([]);
	});

	it('still rejects a tertiary-only shell when it is actually in the secondary slot', () => {
		const selection = getDefaultSelection(catalog, 'recall');
		selection.ammoIds = ['standard', 'leech', 'gargantuan'];
		const imported = importShareCodeToPlannerSelection(exportPlannerSelectionToShareCode(selection));
		expect(imported.selection.ammoIds).toEqual(['standard', 'standard', 'gargantuan']);
		expect(imported.warnings).toEqual(["Siphon can't be loaded in the secondary slot"]);
	});

	it('rejects a UTF-16 string length that extends beyond the payload', () => {
		const compressed = Buffer.from(UNICODE_GAME_FORMAT_SHARE_CODE.slice(6), 'base64url');
		const payload = inflateSync(compressed.subarray(4));
		const nameOffset = payload.indexOf(Buffer.from(UNICODE_NAME, 'utf16le'));
		expect(nameOffset).toBeGreaterThan(4);
		payload.writeInt32LE(-payload.length, nameOffset - 4);
		const invalidCode = `TYR01_${Buffer.concat([compressed.subarray(0, 4), deflateSync(payload)]).toString('base64url')}`;
		expect(() => decodeLoadoutShareCode(invalidCode)).toThrow(/Unexpected end of buffer/);
	});

	it('rejects text that is not a share code', () => {
		expect(() => importShareCodeToPlannerSelection('hello')).toThrow(/valid Tyr share code/);
		expect(() => importShareCodeToPlannerSelection('TYR01_AAAA')).toThrow(/valid Tyr share code/);
	});
});
