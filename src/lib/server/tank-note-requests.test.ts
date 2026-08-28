import { describe, expect, it } from 'vitest';

import { getGameDataBundle } from '$lib/data/game-data';

import { validateUpsertTankNoteBody } from './tank-note-requests';

const vehicle = getGameDataBundle().vehicles[0];

describe('validateUpsertTankNoteBody', () => {
	it('accepts a valid note and trims it', () => {
		const result = validateUpsertTankNoteBody({
			vehicleId: vehicle.id,
			notes: '  Play second line, poke on reload windows.  '
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.notes).toBe('Play second line, poke on reload windows.');
		}
	});

	it('accepts empty notes (clears the notepad)', () => {
		const result = validateUpsertTankNoteBody({ vehicleId: vehicle.id, notes: '' });
		expect(result.success).toBe(true);
	});

	it('rejects unknown vehicle IDs', () => {
		const result = validateUpsertTankNoteBody({ vehicleId: 'no-such-vehicle', notes: 'hi' });
		expect(result.success).toBe(false);
	});

	it('rejects notes over the length limit', () => {
		const result = validateUpsertTankNoteBody({
			vehicleId: vehicle.id,
			notes: 'x'.repeat(2001)
		});
		expect(result.success).toBe(false);
	});

	it('rejects unexpected keys', () => {
		const result = validateUpsertTankNoteBody({
			vehicleId: vehicle.id,
			notes: 'hi',
			debug: true
		});
		expect(result.success).toBe(false);
	});
});
