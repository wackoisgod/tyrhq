import { z } from 'zod';

import { MAX_TANK_NOTES_LENGTH } from '$lib/builds/constants';
import { getGameDataBundle } from '$lib/data/game-data';

const vehicleIds = new Set(getGameDataBundle().vehicles.map((vehicle) => vehicle.id));

export const upsertTankNoteBodySchema = z
	.object({
		vehicleId: z
			.string()
			.min(1, 'vehicleId is required')
			.refine((vehicleId) => vehicleIds.has(vehicleId), 'Unknown vehicleId'),
		notes: z
			.string()
			.trim()
			.max(MAX_TANK_NOTES_LENGTH, `notes must be ${MAX_TANK_NOTES_LENGTH} characters or fewer`)
	})
	.strict();

export type UpsertTankNoteBody = z.infer<typeof upsertTankNoteBodySchema>;

export function validateUpsertTankNoteBody(body: unknown) {
	return upsertTankNoteBodySchema.safeParse(body);
}
