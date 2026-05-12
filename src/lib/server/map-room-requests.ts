import { error } from '@sveltejs/kit';
import { z } from 'zod';

import { getMapBySlug } from '$lib/data/maps';

const ROOM_TITLE_MAX_LENGTH = 80;
const ROOM_TOKEN_LENGTH = 10;
const ROOM_TOKEN_MAX_LENGTH = 64;
const ACTOR_NAME_MAX_LENGTH = 32;
const MAP_SLUG_MAX_LENGTH = 80;
const ID_MAX_LENGTH = 96;
const COLOR_MAX_LENGTH = 16;
const VEHICLE_ID_MAX_LENGTH = 80;
const MAX_STROKE_POINTS = 512;
const MAX_ROOM_STROKES = 500;
const MAX_ROOM_STAMPS = 200;
const MAX_ROOM_SHAPES = 300;
const MAX_STROKE_WIDTH = 64;

const idSchema = z.string().min(1).max(ID_MAX_LENGTH);
const colorSchema = z
	.string()
	.trim()
	.min(1)
	.max(COLOR_MAX_LENGTH)
	.regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a six-digit hex value');
const coordinateSchema = z.number().finite().min(0).max(1);
const strokeWidthSchema = z.number().finite().positive().max(MAX_STROKE_WIDTH);

const pointSchema = z
	.object({
		x: coordinateSchema,
		y: coordinateSchema
	})
	.strict();

const lineStyleSchema = z.enum(['solid', 'dashed', 'dotted']);
const lineEndSchema = z.enum(['none', 'arrow', 'stop']);

const strokeSchema = z
	.object({
		id: idSchema,
		points: z.array(pointSchema).min(2).max(MAX_STROKE_POINTS),
		color: colorSchema,
		width: strokeWidthSchema,
		tool: z.enum(['pen', 'eraser']),
		lineStyle: lineStyleSchema,
		endType: lineEndSchema
	})
	.strict();

const stampSchema = z
	.object({
		id: idSchema,
		pos: pointSchema,
		stamp: z.enum(['tank', 'zone']),
		side: z.enum(['friendly', 'enemy']),
		vehicleId: z.string().min(1).max(VEHICLE_ID_MAX_LENGTH).optional(),
		showVision: z.boolean().optional()
	})
	.strict();

const shapeSchema = z
	.object({
		id: idSchema,
		kind: z.enum(['line', 'measure', 'circle', 'rectangle', 'ping']),
		start: pointSchema,
		end: pointSchema,
		color: colorSchema,
		width: strokeWidthSchema,
		lineStyle: lineStyleSchema,
		endType: lineEndSchema
	})
	.strict();

const compactPointSchema = z.tuple([coordinateSchema, coordinateSchema]);

const compactStrokeSchema = z
	.object({
		i: idSchema.optional(),
		p: z.array(compactPointSchema).min(2).max(MAX_STROKE_POINTS).optional(),
		c: colorSchema.optional(),
		w: strokeWidthSchema.optional(),
		t: z.enum(['e', 'p']).optional(),
		l: z.enum(['s', 'd', 'o']).optional(),
		e: z.enum(['n', 'a', 't', 'b']).optional()
	})
	.strict();

const compactStampSchema = z
	.object({
		i: idSchema.optional(),
		x: coordinateSchema.optional(),
		y: coordinateSchema.optional(),
		s: z.enum(['t', 'z']).optional(),
		d: z.enum(['f', 'e']).optional(),
		v: z.string().min(1).max(VEHICLE_ID_MAX_LENGTH).optional(),
		r: z.literal(1).optional()
	})
	.strict();

const compactShapeSchema = z
	.object({
		i: idSchema.optional(),
		k: z.enum(['a', 'l', 'm', 'c', 'r', 'p']).optional(),
		x1: coordinateSchema.optional(),
		y1: coordinateSchema.optional(),
		x2: coordinateSchema.optional(),
		y2: coordinateSchema.optional(),
		c: colorSchema.optional(),
		w: strokeWidthSchema.optional(),
		l: z.enum(['s', 'd', 'o']).optional(),
		e: z.enum(['n', 'a', 't', 'b']).optional()
	})
	.strict();

export const compactStateSchema = z
	.object({
		s: z.array(compactStrokeSchema).max(MAX_ROOM_STROKES).optional(),
		t: z.array(compactStampSchema).max(MAX_ROOM_STAMPS).optional(),
		h: z.array(compactShapeSchema).max(MAX_ROOM_SHAPES).optional()
	})
	.strict();

export const plannerOperationSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('add_stroke'), stroke: strokeSchema }).strict(),
	z.object({ type: z.literal('delete_stroke'), strokeId: idSchema }).strict(),
	z.object({ type: z.literal('add_shape'), shape: shapeSchema }).strict(),
	z.object({ type: z.literal('update_shape'), shape: shapeSchema }).strict(),
	z.object({ type: z.literal('delete_shape'), shapeId: idSchema }).strict(),
	z.object({ type: z.literal('add_stamp'), stamp: stampSchema }).strict(),
	z.object({ type: z.literal('update_stamp'), stamp: stampSchema }).strict(),
	z.object({ type: z.literal('delete_stamp'), stampId: idSchema }).strict(),
	z.object({ type: z.literal('clear_room') }).strict()
]);

export const createMapRoomBodySchema = z
	.object({
		mapSlug: z.string().min(1).max(MAP_SLUG_MAX_LENGTH),
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

export const updateMapRoomBodySchema = z
	.object({
		mapSlug: z.string().min(1).max(MAP_SLUG_MAX_LENGTH)
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
		eventId: idSchema,
		actorId: idSchema,
		actorName: z.string().trim().min(1).max(ACTOR_NAME_MAX_LENGTH),
		clientTs: z.string().datetime({ offset: true }),
		operation: plannerOperationSchema
	})
	.strict();

export const mapRoomTokenSchema = z
	.string()
	.trim()
	.max(ROOM_TOKEN_MAX_LENGTH)
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
export type UpdateMapRoomBody = z.infer<typeof updateMapRoomBodySchema>;
export type MapRoomEventBody = z.infer<typeof mapRoomEventBodySchema>;
