export type Point = { x: number; y: number };

export type LineStyle = 'solid' | 'dashed' | 'dotted';
export type LineEnd = 'none' | 'arrow' | 'stop';
export type StampType = 'tank' | 'zone';
export type ShapeKind = 'line' | 'measure' | 'circle' | 'rectangle' | 'ping';

export type Stroke = {
	id: string;
	points: Point[];
	color: string;
	width: number;
	tool: 'pen' | 'eraser';
	lineStyle: LineStyle;
	endType: LineEnd;
	layerId?: string;
};

export type StampEntry = {
	id: string;
	pos: Point;
	stamp: StampType;
	side: 'friendly' | 'enemy';
	vehicleId?: string;
	showVision?: boolean;
	layerId?: string;
};

export type ShapeEntry = {
	id: string;
	kind: ShapeKind;
	start: Point;
	end: Point;
	color: string;
	width: number;
	lineStyle: LineStyle;
	endType: LineEnd;
	layerId?: string;
};

export type ShapeDraft = Omit<ShapeEntry, 'id'>;

/**
 * A drawing layer, in the spirit of Photoshop layers. Layers are stored
 * bottom-to-top: index 0 renders first (furthest back), the last entry renders
 * last (closest to the viewer). Every stroke, stamp, and shape belongs to a
 * single layer via its `layerId`.
 */
export type Layer = {
	id: string;
	name: string;
	visible: boolean;
	locked: boolean;
	opacity: number;
};

export type PlannerState = {
	strokes: Stroke[];
	stamps: StampEntry[];
	shapes: ShapeEntry[];
	layers: Layer[];
};

export const DEFAULT_LAYER_ID = 'layer_base';
export const DEFAULT_LAYER_NAME = 'Base Layer';
export const MAX_PLANNER_LAYERS = 12;

export type CompactStroke = {
	i?: string;
	p?: number[][];
	c?: string;
	w?: number;
	t?: 'e' | 'p';
	l?: 's' | 'd' | 'o';
	e?: 'n' | 'a' | 't' | 'b';
	g?: string;
};

export type CompactStamp = {
	i?: string;
	x?: number;
	y?: number;
	s?: 't' | 'z';
	d?: 'f' | 'e';
	v?: string;
	r?: 1;
	g?: string;
};

export type CompactShape = {
	i?: string;
	k?: 'a' | 'l' | 'm' | 'c' | 'r' | 'p';
	x1?: number;
	y1?: number;
	x2?: number;
	y2?: number;
	c?: string;
	w?: number;
	l?: 's' | 'd' | 'o';
	e?: 'n' | 'a' | 't' | 'b';
	g?: string;
};

export type CompactLayer = {
	i?: string;
	n?: string;
	v?: 0;
	k?: 1;
	o?: number;
};

export type CompactState = {
	s?: CompactStroke[];
	t?: CompactStamp[];
	h?: CompactShape[];
	y?: CompactLayer[];
};

export type PlannerOperation =
	| { type: 'add_stroke'; stroke: Stroke }
	| { type: 'delete_stroke'; strokeId: string }
	| { type: 'add_shape'; shape: ShapeEntry }
	| { type: 'update_shape'; shape: ShapeEntry }
	| { type: 'delete_shape'; shapeId: string }
	| { type: 'add_stamp'; stamp: StampEntry }
	| { type: 'update_stamp'; stamp: StampEntry }
	| { type: 'delete_stamp'; stampId: string }
	| { type: 'add_layer'; layer: Layer }
	| { type: 'update_layer'; layer: Layer }
	| { type: 'delete_layer'; layerId: string }
	| { type: 'reorder_layers'; order: string[] }
	| { type: 'move_to_layer'; targetLayerId: string; objectIds: string[] }
	| { type: 'translate_layer'; layerId: string; dx: number; dy: number }
	| { type: 'clear_room' };

export type PlannerOperationEnvelope = {
	eventId: string;
	actorId: string;
	actorName: string;
	clientTs: string;
	operation: PlannerOperation;
};

export type PlannerParticipantPresence = {
	key: string;
	name: string;
	tool: string;
	isHost: boolean;
	joinedAt: string;
};

export function createDefaultLayer(): Layer {
	return {
		id: DEFAULT_LAYER_ID,
		name: DEFAULT_LAYER_NAME,
		visible: true,
		locked: false,
		opacity: 1
	};
}

export function createEmptyPlannerState(): PlannerState {
	return {
		strokes: [],
		stamps: [],
		shapes: [],
		layers: [createDefaultLayer()]
	};
}

export function createPlannerId(
	prefix: 'event' | 'shape' | 'stamp' | 'stroke' | 'layer' | 'guest' = 'stroke'
) {
	if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
		return `${prefix}_${globalThis.crypto.randomUUID()}`;
	}

	const random = Math.random().toString(36).slice(2, 10);
	const timestamp = Date.now().toString(36);
	return `${prefix}_${timestamp}${random}`;
}

function clonePoints(points: Point[]) {
	return points.map((point) => ({ ...point }));
}

export function clonePlannerState(state: PlannerState): PlannerState {
	return {
		strokes: state.strokes.map((stroke) => ({
			...stroke,
			points: clonePoints(stroke.points)
		})),
		stamps: state.stamps.map((stamp) => ({
			...stamp,
			pos: { ...stamp.pos }
		})),
		shapes: state.shapes.map((shape) => ({
			...shape,
			start: { ...shape.start },
			end: { ...shape.end }
		})),
		layers: state.layers.map((layer) => ({ ...layer }))
	};
}

function clampOpacity(value: number) {
	if (!Number.isFinite(value)) return 1;
	return Math.min(1, Math.max(0, value));
}

function roundCoord(value: number) {
	return Math.round(value * 1000) / 1000;
}

function shapeKindToCode(kind: ShapeKind): CompactShape['k'] {
	if (kind === 'line') return 'l';
	if (kind === 'measure') return 'm';
	if (kind === 'circle') return 'c';
	if (kind === 'rectangle') return 'r';
	return 'p';
}

function codeToShapeKind(code: CompactShape['k']): ShapeKind {
	if (code === 'a' || code === 'l') return 'line';
	if (code === 'm') return 'measure';
	if (code === 'c') return 'circle';
	if (code === 'r') return 'rectangle';
	return 'ping';
}

function lineStyleToCode(style: LineStyle): CompactShape['l'] {
	if (style === 'dashed') return 'd';
	if (style === 'dotted') return 'o';
	return 's';
}

function codeToLineStyle(code: CompactShape['l'] | undefined, kind: ShapeKind): LineStyle {
	if (code === 'd') return 'dashed';
	if (code === 'o') return 'dotted';
	if (kind === 'measure') return 'dashed';
	return 'solid';
}

function lineEndToCode(endType: LineEnd): CompactShape['e'] {
	if (endType === 'arrow') return 'a';
	if (endType === 'stop') return 't';
	return 'n';
}

function codeToLineEnd(code: CompactShape['e'] | undefined): LineEnd {
	if (code === 'a' || code === 'b') return 'arrow';
	if (code === 't') return 'stop';
	return 'none';
}

// A layer reference only needs to be serialized when it points somewhere other
// than the implicit base layer, so single-layer plans stay byte-for-byte
// compatible with the pre-layers format.
function compactLayerRef(layerId: string | undefined): string | undefined {
	return layerId && layerId !== DEFAULT_LAYER_ID ? layerId : undefined;
}

export function buildCompactState(state: PlannerState): CompactState {
	const compact: CompactState = {
		s: state.strokes.map((stroke) => {
			const entry: CompactStroke = {
				i: stroke.id,
				p: stroke.points.map((point) => [roundCoord(point.x), roundCoord(point.y)]),
				c: stroke.color,
				w: Math.round(stroke.width * 10) / 10,
				t: stroke.tool === 'eraser' ? 'e' : 'p',
				l: lineStyleToCode(stroke.lineStyle),
				e: lineEndToCode(stroke.endType)
			};
			const g = compactLayerRef(stroke.layerId);
			if (g) entry.g = g;
			return entry;
		}),
		t: state.stamps.map((stamp) => {
			const entry: CompactStamp = {
				i: stamp.id,
				x: roundCoord(stamp.pos.x),
				y: roundCoord(stamp.pos.y),
				s: stamp.stamp === 'tank' ? 't' : 'z',
				d: stamp.side === 'friendly' ? 'f' : 'e'
			};
			if (stamp.vehicleId) entry.v = stamp.vehicleId;
			if (stamp.showVision) entry.r = 1;
			const g = compactLayerRef(stamp.layerId);
			if (g) entry.g = g;
			return entry;
		}),
		h: state.shapes.map((shape) => {
			const entry: CompactShape = {
				i: shape.id,
				k: shapeKindToCode(shape.kind),
				x1: roundCoord(shape.start.x),
				y1: roundCoord(shape.start.y),
				x2: roundCoord(shape.end.x),
				y2: roundCoord(shape.end.y),
				c: shape.color,
				w: Math.round(shape.width * 10) / 10,
				l: lineStyleToCode(shape.lineStyle),
				e: lineEndToCode(shape.endType)
			};
			const g = compactLayerRef(shape.layerId);
			if (g) entry.g = g;
			return entry;
		})
	};

	// Only emit the layer table when it carries more than the implicit base
	// layer; a lone untouched base layer round-trips without it.
	const isImplicitBaseLayer =
		state.layers.length === 1 &&
		state.layers[0].id === DEFAULT_LAYER_ID &&
		state.layers[0].name === DEFAULT_LAYER_NAME &&
		state.layers[0].visible &&
		!state.layers[0].locked &&
		state.layers[0].opacity === 1;

	if (state.layers.length > 0 && !isImplicitBaseLayer) {
		compact.y = state.layers.map((layer) => {
			const entry: CompactLayer = { i: layer.id, n: layer.name };
			if (!layer.visible) entry.v = 0;
			if (layer.locked) entry.k = 1;
			if (layer.opacity !== 1) entry.o = Math.round(clampOpacity(layer.opacity) * 100) / 100;
			return entry;
		});
	}

	return compact;
}

export function parseCompactState(data: CompactState): PlannerState {
	const layers: Layer[] =
		data.y && data.y.length > 0
			? data.y.map((layer) => ({
					id: layer.i ?? createPlannerId('layer'),
					name: layer.n ?? DEFAULT_LAYER_NAME,
					visible: layer.v !== 0,
					locked: layer.k === 1,
					opacity: typeof layer.o === 'number' ? clampOpacity(layer.o) : 1
				}))
			: [createDefaultLayer()];

	const layerIds = new Set(layers.map((layer) => layer.id));
	const fallbackLayerId = layerIds.has(DEFAULT_LAYER_ID) ? DEFAULT_LAYER_ID : layers[0].id;
	const resolveLayerId = (ref: string | undefined) =>
		ref && layerIds.has(ref) ? ref : fallbackLayerId;

	const strokes: Stroke[] = (data.s ?? []).flatMap((stroke) => {
		if (!stroke.p || !stroke.c || typeof stroke.w !== 'number') return [];
		return [
			{
				id: stroke.i ?? createPlannerId('stroke'),
				points: stroke.p.map(([x = 0, y = 0]) => ({ x, y })),
				color: stroke.c,
				width: stroke.w,
				tool: stroke.t === 'e' ? 'eraser' : 'pen',
				lineStyle: codeToLineStyle(stroke.l, 'line'),
				endType: codeToLineEnd(stroke.e),
				layerId: resolveLayerId(stroke.g)
			}
		];
	});

	const stamps: StampEntry[] = (data.t ?? []).flatMap((stamp) => {
		if (typeof stamp.x !== 'number' || typeof stamp.y !== 'number') return [];
		return [
			{
				id: stamp.i ?? createPlannerId('stamp'),
				pos: { x: stamp.x, y: stamp.y },
				stamp: stamp.s === 'z' ? 'zone' : 'tank',
				side: stamp.d === 'e' ? 'enemy' : 'friendly',
				...(stamp.v ? { vehicleId: stamp.v } : {}),
				...(stamp.r ? { showVision: true } : {}),
				layerId: resolveLayerId(stamp.g)
			}
		];
	});

	const shapes: ShapeEntry[] = (data.h ?? []).flatMap((shape) => {
		if (
			typeof shape.x1 !== 'number' ||
			typeof shape.y1 !== 'number' ||
			typeof shape.x2 !== 'number' ||
			typeof shape.y2 !== 'number' ||
			!shape.c ||
			typeof shape.w !== 'number'
		) {
			return [];
		}

		const kind = codeToShapeKind(shape.k);
		return [
			{
				id: shape.i ?? createPlannerId('shape'),
				kind,
				start: { x: shape.x1, y: shape.y1 },
				end: { x: shape.x2, y: shape.y2 },
				color: shape.c,
				width: shape.w,
				lineStyle: codeToLineStyle(shape.l, kind),
				endType: codeToLineEnd(shape.e),
				layerId: resolveLayerId(shape.g)
			}
		];
	});

	return {
		strokes,
		stamps,
		shapes,
		layers
	};
}

function upsertById<T extends { id: string }>(entries: T[], nextEntry: T) {
	const index = entries.findIndex((entry) => entry.id === nextEntry.id);
	if (index === -1) return [...entries, nextEntry];
	return entries.map((entry, entryIndex) => (entryIndex === index ? nextEntry : entry));
}

export function applyPlannerOperation(state: PlannerState, operation: PlannerOperation): PlannerState {
	switch (operation.type) {
		case 'add_stroke':
			return {
				...state,
				strokes: upsertById(state.strokes, {
					...operation.stroke,
					points: clonePoints(operation.stroke.points)
				})
			};
		case 'delete_stroke':
			return {
				...state,
				strokes: state.strokes.filter((stroke) => stroke.id !== operation.strokeId)
			};
		case 'add_shape':
			return {
				...state,
				shapes: upsertById(state.shapes, {
					...operation.shape,
					start: { ...operation.shape.start },
					end: { ...operation.shape.end }
				})
			};
		case 'update_shape':
			return {
				...state,
				shapes: state.shapes.map((shape) =>
					shape.id === operation.shape.id
						? {
								...operation.shape,
								start: { ...operation.shape.start },
								end: { ...operation.shape.end }
							}
						: shape
				)
			};
		case 'delete_shape':
			return {
				...state,
				shapes: state.shapes.filter((shape) => shape.id !== operation.shapeId)
			};
		case 'add_stamp':
			return {
				...state,
				stamps: upsertById(state.stamps, {
					...operation.stamp,
					pos: { ...operation.stamp.pos }
				})
			};
		case 'update_stamp':
			return {
				...state,
				stamps: state.stamps.map((stamp) =>
					stamp.id === operation.stamp.id
						? {
								...operation.stamp,
								pos: { ...operation.stamp.pos }
							}
						: stamp
				)
			};
		case 'delete_stamp':
			return {
				...state,
				stamps: state.stamps.filter((stamp) => stamp.id !== operation.stampId)
			};
		case 'add_layer':
			return {
				...state,
				layers: upsertById(state.layers, { ...operation.layer })
			};
		case 'update_layer':
			return {
				...state,
				layers: state.layers.map((layer) =>
					layer.id === operation.layer.id ? { ...operation.layer } : layer
				)
			};
		case 'delete_layer': {
			// Never delete the final layer — a plan always needs somewhere to draw.
			if (state.layers.length <= 1) return state;
			if (!state.layers.some((layer) => layer.id === operation.layerId)) return state;
			const belongsToLayer = (layerId: string | undefined) =>
				(layerId ?? DEFAULT_LAYER_ID) === operation.layerId;
			return {
				...state,
				layers: state.layers.filter((layer) => layer.id !== operation.layerId),
				strokes: state.strokes.filter((stroke) => !belongsToLayer(stroke.layerId)),
				stamps: state.stamps.filter((stamp) => !belongsToLayer(stamp.layerId)),
				shapes: state.shapes.filter((shape) => !belongsToLayer(shape.layerId))
			};
		}
		case 'reorder_layers': {
			const byId = new Map(state.layers.map((layer) => [layer.id, layer]));
			const next: Layer[] = [];
			for (const id of operation.order) {
				const layer = byId.get(id);
				if (layer && !next.includes(layer)) next.push(layer);
			}
			// Preserve any layers the caller forgot to mention rather than dropping them.
			for (const layer of state.layers) {
				if (!next.includes(layer)) next.push(layer);
			}
			return { ...state, layers: next };
		}
		case 'move_to_layer': {
			if (!state.layers.some((layer) => layer.id === operation.targetLayerId)) return state;
			const ids = new Set(operation.objectIds);
			const reassign = <T extends { id: string; layerId?: string }>(entries: T[]): T[] =>
				entries.map((entry) =>
					ids.has(entry.id) ? { ...entry, layerId: operation.targetLayerId } : entry
				);
			return {
				...state,
				strokes: reassign(state.strokes),
				stamps: reassign(state.stamps),
				shapes: reassign(state.shapes)
			};
		}
		case 'translate_layer': {
			const belongsToLayer = (layerId: string | undefined) =>
				(layerId ?? DEFAULT_LAYER_ID) === operation.layerId;
			const shift = (point: Point): Point => ({
				x: Math.min(1, Math.max(0, point.x + operation.dx)),
				y: Math.min(1, Math.max(0, point.y + operation.dy))
			});
			return {
				...state,
				strokes: state.strokes.map((stroke) =>
					belongsToLayer(stroke.layerId)
						? { ...stroke, points: stroke.points.map(shift) }
						: stroke
				),
				shapes: state.shapes.map((shape) =>
					belongsToLayer(shape.layerId)
						? { ...shape, start: shift(shape.start), end: shift(shape.end) }
						: shape
				),
				stamps: state.stamps.map((stamp) =>
					belongsToLayer(stamp.layerId) ? { ...stamp, pos: shift(stamp.pos) } : stamp
				)
			};
		}
		case 'clear_room':
			return createEmptyPlannerState();
	}
}
