import { describe, expect, it } from 'vitest';

import { calculateSeriesState } from './tournament-series';

describe('tournament series scoring', () => {
	it('completes a best-of-five when a team reaches three wins', () => {
		expect(calculateSeriesState(5, ['a', 'b', 'a', 'a'], 'a', 'b')).toEqual({
			scoreA: 3,
			scoreB: 1,
			winsRequired: 3,
			winnerTeamId: 'a',
			isComplete: true
		});
	});

	it('keeps an unfinished series pending', () => {
		expect(calculateSeriesState(5, ['a', 'b', null], 'a', 'b')).toEqual({
			scoreA: 1,
			scoreB: 1,
			winsRequired: 3,
			winnerTeamId: null,
			isComplete: false
		});
	});

	it('requires four wins in a best-of-seven final', () => {
		const state = calculateSeriesState(7, ['b', 'a', 'b', 'b', 'a', 'b'], 'a', 'b');
		expect(state.scoreA).toBe(2);
		expect(state.scoreB).toBe(4);
		expect(state.winsRequired).toBe(4);
		expect(state.winnerTeamId).toBe('b');
		expect(state.isComplete).toBe(true);
	});

	it('ignores missing and unrelated winner IDs', () => {
		const state = calculateSeriesState(5, ['a', null, 'other', undefined], 'a', 'b');
		expect(state.scoreA).toBe(1);
		expect(state.scoreB).toBe(0);
		expect(state.isComplete).toBe(false);
	});

	it('rejects invalid best-of values', () => {
		expect(() => calculateSeriesState(4, [], 'a', 'b')).toThrow('Best-of must be an odd number');
	});
});
