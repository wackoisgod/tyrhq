/**
 * Confirmation copy after a replay is stored.
 * A completed match keeps its saved series score. Replay games do not replace it.
 */
export function replaySavedMessage(input: {
	seriesScoreLocked: boolean;
	storedScoreA: number;
	storedScoreB: number;
	derivedScoreA: number;
	derivedScoreB: number;
	derivedComplete: boolean;
}): string {
	if (input.seriesScoreLocked) {
		const stays = `Replay saved. Series score stays ${input.storedScoreA}-${input.storedScoreB}.`;
		if (input.storedScoreA !== input.derivedScoreA || input.storedScoreB !== input.derivedScoreB) {
			return `${stays} The quick result overrides the replay-derived score.`;
		}
		return stays;
	}
	if (input.derivedComplete) return 'Replay saved and the series is complete.';
	return `Replay saved. Series score is ${input.storedScoreA}-${input.storedScoreB}.`;
}
