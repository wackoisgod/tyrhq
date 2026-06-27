import { describe, expect, it } from 'vitest';

import {
	applyPlannerOperation,
	buildCompactState,
	createDefaultLayer,
	createEmptyPlannerState,
	DEFAULT_LAYER_ID,
	parseCompactState,
	type Layer,
	type PlannerState
} from './planner';

function createState(): PlannerState {
	return {
		strokes: [
			{
				id: 'stroke_1',
				points: [
					{ x: 0.1, y: 0.2 },
					{ x: 0.4, y: 0.5 }
				],
				color: '#ffffff',
				width: 3,
				tool: 'pen',
				lineStyle: 'solid',
				endType: 'arrow',
				layerId: DEFAULT_LAYER_ID
			}
		],
		stamps: [
			{
				id: 'stamp_1',
				pos: { x: 0.5, y: 0.6 },
				stamp: 'tank',
				side: 'friendly',
				vehicleId: 'blink',
				showVision: true,
				layerId: DEFAULT_LAYER_ID
			}
		],
		shapes: [
			{
				id: 'shape_1',
				kind: 'rectangle',
				start: { x: 0.2, y: 0.2 },
				end: { x: 0.3, y: 0.35 },
				color: '#22c55e',
				width: 4,
				lineStyle: 'dashed',
				endType: 'none',
				layerId: DEFAULT_LAYER_ID
			}
		],
		layers: [createDefaultLayer()]
	};
}

describe('planner serialization', () => {
	it('roundtrips compact state while preserving ids', () => {
		const state = createState();
		const compact = buildCompactState(state);
		const restored = parseCompactState(compact);

		expect(restored).toEqual(state);
	});
});

describe('planner operations', () => {
	it('applies add, update, delete, and clear operations deterministically', () => {
		const initial = createEmptyPlannerState();
		const withStroke = applyPlannerOperation(initial, {
			type: 'add_stroke',
			stroke: createState().strokes[0]
		});
		expect(withStroke.strokes).toHaveLength(1);

		const updatedShape = {
			...createState().shapes[0],
			end: { x: 0.8, y: 0.9 }
		};
		const withShape = applyPlannerOperation(withStroke, {
			type: 'add_shape',
			shape: createState().shapes[0]
		});
		const movedShape = applyPlannerOperation(withShape, {
			type: 'update_shape',
			shape: updatedShape
		});
		expect(movedShape.shapes[0].end).toEqual(updatedShape.end);

		const withStamp = applyPlannerOperation(movedShape, {
			type: 'add_stamp',
			stamp: createState().stamps[0]
		});
		expect(withStamp.stamps).toHaveLength(1);

		const withoutStroke = applyPlannerOperation(withStamp, {
			type: 'delete_stroke',
			strokeId: 'stroke_1'
		});
		expect(withoutStroke.strokes).toHaveLength(0);

		const cleared = applyPlannerOperation(withoutStroke, { type: 'clear_room' });
		expect(cleared).toEqual(createEmptyPlannerState());
	});
});

function makeLayer(id: string, overrides: Partial<Layer> = {}): Layer {
	return { id, name: id, visible: true, locked: false, opacity: 1, ...overrides };
}

describe('planner layers', () => {
	it('round-trips a multi-layer state, including hidden/locked/opacity and object assignment', () => {
		const overlay = makeLayer('layer_overlay', {
			name: 'Overlay',
			visible: false,
			locked: true,
			opacity: 0.5
		});
		const state: PlannerState = {
			...createState(),
			shapes: [{ ...createState().shapes[0], layerId: overlay.id }],
			layers: [createDefaultLayer(), overlay]
		};

		const restored = parseCompactState(buildCompactState(state));
		expect(restored).toEqual(state);
		expect(restored.shapes[0].layerId).toBe('layer_overlay');
	});

	it('keeps the legacy single-layer format compact (no layer table or refs)', () => {
		const compact = buildCompactState(createState());
		expect(compact.y).toBeUndefined();
		expect(compact.h?.[0].g).toBeUndefined();
	});

	it('migrates a pre-layers payload onto the base layer', () => {
		const restored = parseCompactState({
			h: [{ i: 'shape_legacy', k: 'r', x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2, c: '#ffffff', w: 2 }]
		});
		expect(restored.layers).toEqual([createDefaultLayer()]);
		expect(restored.shapes[0].layerId).toBe(DEFAULT_LAYER_ID);
	});

	it('adds, reorders, and deletes layers along with their contents', () => {
		const base = createState();
		const extra = makeLayer('layer_2', { name: 'Tactics' });

		const withLayer = applyPlannerOperation(base, { type: 'add_layer', layer: extra });
		expect(withLayer.layers.map((layer) => layer.id)).toEqual([DEFAULT_LAYER_ID, 'layer_2']);

		const reordered = applyPlannerOperation(withLayer, {
			type: 'reorder_layers',
			order: ['layer_2', DEFAULT_LAYER_ID]
		});
		expect(reordered.layers.map((layer) => layer.id)).toEqual(['layer_2', DEFAULT_LAYER_ID]);

		const moved = applyPlannerOperation(reordered, {
			type: 'move_to_layer',
			targetLayerId: 'layer_2',
			objectIds: ['shape_1']
		});
		expect(moved.shapes[0].layerId).toBe('layer_2');

		const deleted = applyPlannerOperation(moved, { type: 'delete_layer', layerId: 'layer_2' });
		expect(deleted.layers.map((layer) => layer.id)).toEqual([DEFAULT_LAYER_ID]);
		// The shape lived on the deleted layer, so it is gone too.
		expect(deleted.shapes).toHaveLength(0);
		// Strokes and stamps on the base layer survive.
		expect(deleted.strokes).toHaveLength(1);
		expect(deleted.stamps).toHaveLength(1);
	});

	it('refuses to delete the final remaining layer', () => {
		const base = createState();
		const result = applyPlannerOperation(base, { type: 'delete_layer', layerId: DEFAULT_LAYER_ID });
		expect(result).toEqual(base);
	});

	it('translates only the targeted layer’s objects, clamped to bounds', () => {
		const base = createState();
		const extra = makeLayer('layer_2', { name: 'Tactics' });
		const withLayer = applyPlannerOperation(base, { type: 'add_layer', layer: extra });
		const moved = applyPlannerOperation(withLayer, {
			type: 'move_to_layer',
			targetLayerId: 'layer_2',
			objectIds: ['stamp_1']
		});

		const translated = applyPlannerOperation(moved, {
			type: 'translate_layer',
			layerId: DEFAULT_LAYER_ID,
			dx: 0.1,
			dy: -0.05
		});

		// Base-layer objects shift…
		expect(translated.shapes[0].start.x).toBeCloseTo(0.3);
		expect(translated.shapes[0].start.y).toBeCloseTo(0.15);
		expect(translated.strokes[0].points[0].x).toBeCloseTo(0.2);
		expect(translated.strokes[0].points[0].y).toBeCloseTo(0.15);
		// …while the stamp on layer_2 stays put.
		expect(translated.stamps[0].pos).toEqual({ x: 0.5, y: 0.6 });
	});

	it('clamps a layer translation so objects never leave the field', () => {
		const base = createState();
		const translated = applyPlannerOperation(base, {
			type: 'translate_layer',
			layerId: DEFAULT_LAYER_ID,
			dx: 1,
			dy: 1
		});
		for (const point of translated.strokes[0].points) {
			expect(point.x).toBeLessThanOrEqual(1);
			expect(point.y).toBeLessThanOrEqual(1);
		}
		expect(translated.stamps[0].pos).toEqual({ x: 1, y: 1 });
	});

	it('updates layer visibility without touching objects', () => {
		const base = createState();
		const hidden = applyPlannerOperation(base, {
			type: 'update_layer',
			layer: { ...createDefaultLayer(), visible: false }
		});
		expect(hidden.layers[0].visible).toBe(false);
		expect(hidden.strokes).toEqual(base.strokes);
	});
});
