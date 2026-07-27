import rawTalentTreeData from '$lib/data/raw/TalentTreeData.json';

import { getGameDataBundle } from '$lib/data/game-data';
import {
	extractTalentValueTokens,
	type TalentValueToken
} from '$lib/game-engine/component-format';

type RawTalentEntry = {
	Name: string;
	TalentDescription: string;
};

let cached: Record<string, TalentValueToken[]> | null = null;

/**
 * The generated runtime bundle flattens description placeholders like
 * {LevelValuePercent} down to the literal word "value", which loses how the
 * point values must be scaled for display (percent vs flat vs absolute vs
 * multiplier). Recover each talent's ordered token list from the raw
 * TalentTreeData drop, keyed by talent id. Server-only so the ~300KB raw file
 * stays out of the client bundle.
 */
export function getTalentValueTokens(): Record<string, TalentValueToken[]> {
	if (cached) return cached;

	const rawDescriptionByKey = new Map(
		(rawTalentTreeData as RawTalentEntry[]).map((entry) => [entry.Name, entry.TalentDescription])
	);

	const tokensByTalentId: Record<string, TalentValueToken[]> = {};
	for (const talent of getGameDataBundle().talents) {
		const rawDescription = rawDescriptionByKey.get(talent.key);
		if (!rawDescription) continue;
		const tokens = extractTalentValueTokens(rawDescription);
		if (tokens.length > 0) tokensByTalentId[talent.id] = tokens;
	}

	cached = tokensByTalentId;
	return cached;
}
