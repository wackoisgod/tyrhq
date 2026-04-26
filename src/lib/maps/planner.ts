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
};

export type StampEntry = {
	id: string;
	pos: Point;
	stamp: StampType;
	side: 'friendly' | 'enemy';
	vehicleId?: string;
	showVision?: boolean;
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
};

export type ShapeDraft = Omit<ShapeEntry, 'id'>;

export type PlannerState = {
	strokes: Stroke[];
	stamps: StampEntry[];
	shapes: ShapeEntry[];
};

export type CompactStroke = {
	i?: string;
	p?: number[][];
	c?: string;
	w?: number;
	t?: 'e' | 'p';
	l?: 's' | 'd' | 'o';
	e?: 'n' | 'a' | 't' | 'b';
};

export type CompactStamp = {
	i?: string;
	x?: number;
	y?: number;
	s?: 't' | 'z';
	d?: 'f' | 'e';
	v?: string;
	r?: 1;
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
};

export type CompactState = {
	s?: CompactStroke[];
	t?: CompactStamp[];
	h?: CompactShape[];
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

export function createEmptyPlannerState(): PlannerState {
	return {
		strokes: [],
		stamps: [],
		shapes: []
	};
}

export function createPlannerId(prefix: 'event' | 'shape' | 'stamp' | 'stroke' | 'guest' = 'stroke') {
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
		}))
	};
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

export function buildCompactState(state: PlannerState): CompactState {
	return {
		s: state.strokes.map((stroke) => ({
			i: stroke.id,
			p: stroke.points.map((point) => [roundCoord(point.x), roundCoord(point.y)]),
			c: stroke.color,
			w: Math.round(stroke.width * 10) / 10,
			t: stroke.tool === 'eraser' ? 'e' : 'p',
			l: lineStyleToCode(stroke.lineStyle),
			e: lineEndToCode(stroke.endType)
		})),
		t: state.stamps.map((stamp) => {
			const compact: CompactStamp = {
				i: stamp.id,
				x: roundCoord(stamp.pos.x),
				y: roundCoord(stamp.pos.y),
				s: stamp.stamp === 'tank' ? 't' : 'z',
				d: stamp.side === 'friendly' ? 'f' : 'e'
			};
			if (stamp.vehicleId) compact.v = stamp.vehicleId;
			if (stamp.showVision) compact.r = 1;
			return compact;
		}),
		h: state.shapes.map((shape) => ({
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
		}))
	};
}

export function parseCompactState(data: CompactState): PlannerState {
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
				endType: codeToLineEnd(stroke.e)
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
				...(stamp.r ? { showVision: true } : {})
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
				endType: codeToLineEnd(shape.e)
			}
		];
	});

	return {
		strokes,
		stamps,
		shapes
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
		case 'clear_room':
			return createEmptyPlannerState();
	}
}
