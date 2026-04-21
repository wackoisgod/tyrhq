import { error } from '@sveltejs/kit';
import { z } from 'zod';

import { getMapBySlug } from '$lib/data/maps';

const ROOM_TITLE_MAX_LENGTH = 80;
const ROOM_TOKEN_LENGTH = 10;
const ACTOR_NAME_MAX_LENGTH = 32;

const pointSchema = z
	.object({
		x: z.number().min(0).max(1),
		y: z.number().min(0).max(1)
	})
	.strict();

const lineStyleSchema = z.enum(['solid', 'dashed', 'dotted']);
const lineEndSchema = z.enum(['none', 'arrow', 'stop']);

const strokeSchema = z
	.object({
		id: z.string().min(1),
		points: z.array(pointSchema).min(2),
		color: z.string().min(1),
		width: z.number().positive(),
		tool: z.enum(['pen', 'eraser']),
		lineStyle: lineStyleSchema,
		endType: lineEndSchema
	})
	.strict();

const stampSchema = z
	.object({
		id: z.string().min(1),
		pos: pointSchema,
		stamp: z.enum(['tank', 'zone']),
		side: z.enum(['friendly', 'enemy']),
		vehicleId: z.string().min(1).optional(),
		showVision: z.boolean().optional()
	})
	.strict();

const shapeSchema = z
	.object({
		id: z.string().min(1),
		kind: z.enum(['line', 'measure', 'circle', 'rectangle', 'ping']),
		start: pointSchema,
		end: pointSchema,
		color: z.string().min(1),
		width: z.number().positive(),
		lineStyle: lineStyleSchema,
		endType: lineEndSchema
	})
	.strict();

const compactStrokeSchema = z
	.object({
		i: z.string().min(1).optional(),
		p: z.array(z.tuple([z.number(), z.number()])).optional(),
		c: z.string().min(1).optional(),
		w: z.number().positive().optional(),
		t: z.enum(['e', 'p']).optional(),
		l: z.enum(['s', 'd', 'o']).optional(),
		e: z.enum(['n', 'a', 't', 'b']).optional()
	})
	.strict();

const compactStampSchema = z
	.object({
		i: z.string().min(1).optional(),
		x: z.number().min(0).max(1).optional(),
		y: z.number().min(0).max(1).optional(),
		s: z.enum(['t', 'z']).optional(),
		d: z.enum(['f', 'e']).optional(),
		v: z.string().min(1).optional(),
		r: z.literal(1).optional()
	})
	.strict();

const compactShapeSchema = z
	.object({
		i: z.string().min(1).optional(),
		k: z.enum(['a', 'l', 'm', 'c', 'r', 'p']).optional(),
		x1: z.number().min(0).max(1).optional(),
		y1: z.number().min(0).max(1).optional(),
		x2: z.number().min(0).max(1).optional(),
		y2: z.number().min(0).max(1).optional(),
		c: z.string().min(1).optional(),
		w: z.number().positive().optional(),
		l: z.enum(['s', 'd', 'o']).optional(),
		e: z.enum(['n', 'a', 't', 'b']).optional()
	})
	.strict();

export const compactStateSchema = z
	.object({
		s: z.array(compactStrokeSchema).optional(),
		t: z.array(compactStampSchema).optional(),
		h: z.array(compactShapeSchema).optional()
	})
	.strict();

export const plannerOperationSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('add_stroke'), stroke: strokeSchema }).strict(),
	z.object({ type: z.literal('delete_stroke'), strokeId: z.string().min(1) }).strict(),
	z.object({ type: z.literal('add_shape'), shape: shapeSchema }).strict(),
	z.object({ type: z.literal('update_shape'), shape: shapeSchema }).strict(),
	z.object({ type: z.literal('delete_shape'), shapeId: z.string().min(1) }).strict(),
	z.object({ type: z.literal('add_stamp'), stamp: stampSchema }).strict(),
	z.object({ type: z.literal('update_stamp'), stamp: stampSchema }).strict(),
	z.object({ type: z.literal('delete_stamp'), stampId: z.string().min(1) }).strict(),
	z.object({ type: z.literal('clear_room') }).strict()
]);

export const createMapRoomBodySchema = z
	.object({
		mapSlug: z.string().min(1),
		title: z.string().trim().max(ROOM_TITLE_MAX_LENGTH).optional(),
		state: compactStateSchema.optional()
	})
	.strict()
	.superRefine((body, ctx) => {
		if (!getMapBySlug(body.mapSlug)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['mapSlug'],
				message: 'Unknown mapSlug'
			});
		}
	});

export const mapRoomEventBodySchema = z
	.object({
		eventId: z.string().min(1),
		actorId: z.string().min(1),
		actorName: z.string().trim().min(1).max(ACTOR_NAME_MAX_LENGTH),
		clientTs: z.string().datetime({ offset: true }),
		operation: plannerOperationSchema
	})
	.strict();

export const mapRoomTokenSchema = z
	.string()
	.trim()
	.regex(new RegExp(`^[A-Za-z0-9_-]{${ROOM_TOKEN_LENGTH},}$`), 'Invalid room token');

function formatValidationError(validationError: z.ZodError) {
	const [issue] = validationError.issues;
	if (!issue) return 'Invalid request body';

	const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
	return `${path}${issue.message}`;
}

export function normalizeMapRoomTitle(title: string | undefined, fallback: string) {
	return title?.trim() ? title.trim() : fallback;
}

export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>) {
	let body: unknown;

	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	const parsed = schema.safeParse(body);
	if (!parsed.success) {
		error(400, formatValidationError(parsed.error));
	}

	return parsed.data;
}

export function parseRoomToken(token: string) {
	const parsed = mapRoomTokenSchema.safeParse(token);
	if (!parsed.success) {
		error(404, 'Room not found');
	}

	return parsed.data;
}

export type CreateMapRoomBody = z.infer<typeof createMapRoomBodySchema>;
export type MapRoomEventBody = z.infer<typeof mapRoomEventBodySchema>;
