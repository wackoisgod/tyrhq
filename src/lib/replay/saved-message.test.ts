import { describe, expect, it } from 'vitest';

import { replaySavedMessage } from './saved-message';

describe('replay saved message', () => {
	it('reports the replay-derived score when that score is what gets stored', () => {
		expect(
			replaySavedMessage({
				seriesScoreLocked: false,
				storedScoreA: 1,
				storedScoreB: 0,
				derivedScoreA: 1,
				derivedScoreB: 0,
				derivedComplete: false
			})
		).toBe('Replay saved. Series score is 1-0.');
	});

	it('keeps a completed quick result when the replay tally is different', () => {
		expect(
			replaySavedMessage({
				seriesScoreLocked: true,
				storedScoreA: 4,
				storedScoreB: 0,
				derivedScoreA: 1,
				derivedScoreB: 0,
				derivedComplete: false
			})
		).toBe('Replay saved. Series score stays 4-0. The quick result overrides the replay-derived score.');
	});

	it('reports the stored score when a completed series already matches the replay tally', () => {
		expect(
			replaySavedMessage({
				seriesScoreLocked: true,
				storedScoreA: 4,
				storedScoreB: 0,
				derivedScoreA: 4,
				derivedScoreB: 0,
				derivedComplete: true
			})
		).toBe('Replay saved. Series score stays 4-0.');
	});
});
