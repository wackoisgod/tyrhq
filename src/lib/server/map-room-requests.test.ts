import { describe, expect, it } from 'vitest';

import { compactStateSchema, mapRoomEventBodySchema, mapRoomTokenSchema } from './map-room-requests';

const point = { x: 0.5, y: 0.5 };

describe('mapRoomEventBodySchema', () => {
	it('rejects oversized stroke payloads', () => {
		const points = Array.from({ length: 513 }, () => point);
		const parsed = mapRoomEventBodySchema.safeParse({
			eventId: 'event_1',
			actorId: 'guest_1',
			actorName: 'Pilot',
			clientTs: new Date().toISOString(),
			operation: {
				type: 'add_stroke',
				stroke: {
					id: 'stroke_1',
					points,
					color: '#ffffff',
					width: 4,
					tool: 'pen',
					lineStyle: 'solid',
					endType: 'none'
				}
			}
		});

		expect(parsed.success).toBe(false);
	});

	it('rejects non-hex CSS values', () => {
		const parsed = mapRoomEventBodySchema.safeParse({
			eventId: 'event_1',
			actorId: 'guest_1',
			actorName: 'Pilot',
			clientTs: new Date().toISOString(),
			operation: {
				type: 'add_shape',
				shape: {
					id: 'shape_1',
					kind: 'line',
					start: point,
					end: point,
					color: 'url(https://example.invalid/x)',
					width: 4,
					lineStyle: 'solid',
					endType: 'none'
				}
			}
		});

		expect(parsed.success).toBe(false);
	});
});

describe('compactStateSchema', () => {
	it('caps initial room state arrays', () => {
		const parsed = compactStateSchema.safeParse({
			s: Array.from({ length: 501 }, (_, index) => ({
				i: `stroke_${index}`,
				p: [
					[0.1, 0.1],
					[0.2, 0.2]
				],
				c: '#ffffff',
				w: 4,
				t: 'p',
				l: 's',
				e: 'n'
			}))
		});

		expect(parsed.success).toBe(false);
	});
});

describe('mapRoomTokenSchema', () => {
	it('rejects path-length abuse', () => {
		expect(mapRoomTokenSchema.safeParse('a'.repeat(65)).success).toBe(false);
	});
});
