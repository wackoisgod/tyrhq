import { describe, expect, it } from 'vitest';

import {
	applyPlannerOperation,
	buildCompactState,
	createEmptyPlannerState,
	parseCompactState,
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
				endType: 'arrow'
			}
		],
		stamps: [
			{
				id: 'stamp_1',
				pos: { x: 0.5, y: 0.6 },
				stamp: 'tank',
				side: 'friendly',
				vehicleId: 'blink',
				showVision: true
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
				endType: 'none'
			}
		]
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
