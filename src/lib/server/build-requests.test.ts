import { describe, expect, it } from 'vitest';

import { MAX_BUILD_NOTES_LENGTH } from '$lib/builds/constants';
import { getGameDataBundle } from '$lib/data/game-data';
import { createPlannerCatalog, getDefaultSelection } from '$lib/game-engine/build';

import {
	validateCreateBuildBody,
	validateToggleBuildStarBody
} from './build-requests';

const catalog = createPlannerCatalog(getGameDataBundle());
const vehicle = catalog.vehicles.find((entry) => entry.loadout.componentSlotCount > 1) ?? catalog.vehicles[0];

describe('validateCreateBuildBody', () => {
	it('accepts a valid planner payload', () => {
		const selection = getDefaultSelection(catalog, vehicle.id);
		const result = validateCreateBuildBody({
			title: 'Frontline Setup',
			vehicleId: vehicle.id,
			selection,
			isPublic: true
		});

		expect(result.success).toBe(true);
	});

	it('rejects mismatched vehicle IDs', () => {
		const selection = getDefaultSelection(catalog, vehicle.id);
		const differentVehicle =
			catalog.vehicles.find((entry) => entry.id !== vehicle.id) ?? catalog.vehicles[0];

		const result = validateCreateBuildBody({
			title: 'Frontline Setup',
			vehicleId: differentVehicle.id,
			selection,
			isPublic: false
		});

		expect(result.success).toBe(false);
	});

	it('rejects duplicate components', () => {
		const selection = getDefaultSelection(catalog, vehicle.id);
		const componentId = catalog.components[0]?.id;

		if (!componentId || selection.componentIds.length < 2) {
			throw new Error('Expected a vehicle with at least two component slots');
		}

		selection.componentIds = selection.componentIds.map((_, index) =>
			index < 2 ? componentId : ''
		);

		const result = validateCreateBuildBody({
			title: 'Duplicate Components',
			vehicleId: vehicle.id,
			selection,
			isPublic: false
		});

		expect(result.success).toBe(false);
	});

	it('rejects unexpected keys', () => {
		const selection = getDefaultSelection(catalog, vehicle.id);
		const result = validateCreateBuildBody({
			title: 'Frontline Setup',
			vehicleId: vehicle.id,
			selection,
			isPublic: false,
			debug: true
		});

		expect(result.success).toBe(false);
	});

	it('accepts playstyle notes and trims them', () => {
		const selection = getDefaultSelection(catalog, vehicle.id);
		const result = validateCreateBuildBody({
			title: 'Frontline Setup',
			vehicleId: vehicle.id,
			selection,
			isPublic: true,
			notes: '  Hold the second line until your ability is up.  '
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.notes).toBe('Hold the second line until your ability is up.');
		}
	});

	it('rejects notes over the length limit', () => {
		const selection = getDefaultSelection(catalog, vehicle.id);
		const result = validateCreateBuildBody({
			title: 'Frontline Setup',
			vehicleId: vehicle.id,
			selection,
			isPublic: false,
			notes: 'x'.repeat(MAX_BUILD_NOTES_LENGTH + 1)
		});

		expect(result.success).toBe(false);
	});
});

describe('validateToggleBuildStarBody', () => {
	it('rejects invalid build IDs', () => {
		const result = validateToggleBuildStarBody({ buildId: 'not-a-uuid' });
		expect(result.success).toBe(false);
	});
});
