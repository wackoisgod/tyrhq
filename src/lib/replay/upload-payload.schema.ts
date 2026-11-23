import { z } from 'zod';

const teamSchema = z.union([z.literal(0), z.literal(1)]);
const statSchema = z.number().int().min(0).max(2_000_000_000).nullable();

export const replayUploadPayloadSchema = z
	.object({
		replayGuid: z
			.string()
			.regex(/^[0-9a-f]{32}$/i, 'Replay id is invalid.')
			.transform((value) => value.toLowerCase()),
		changelist: z.number().int().min(0).max(10_000_000).nullable(),
		winnerTeam: teamSchema.nullable(),
		roster: z
			.array(
				z
					.object({
						name: z.string().trim().min(1).max(128),
						teamId: teamSchema,
						steamId: z
							.string()
							.regex(/^\d{15,20}$/)
							.nullable(),
						clan: z.string().max(64).nullable()
					})
					.strict()
			)
			.max(32),
		endgameStats: z
			.array(
				z
					.object({
						name: z.string().trim().min(1).max(128),
						team: teamSchema,
						kills: statSchema,
						damage: statSchema,
						blocked: statSchema,
						assist: statSchema,
						tankIdx: z.number().int().min(0).max(63).nullable(),
						tank: z.string().max(64).nullable(),
						partyId: z.string().max(64).nullable()
					})
					.strict()
			)
			.max(32),
		warnings: z.array(z.string().max(400)).max(40)
	})
	.strict();

export const MAX_REPLAY_PAYLOAD_CHARS = 200_000;
