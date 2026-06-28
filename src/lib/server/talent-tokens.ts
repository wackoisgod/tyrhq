import rawTalents from '$lib/data/raw/TalentTreeData.json';
import type { ComponentValueToken } from '$lib/game-engine/component-format';

/**
 * The generated `runtime.json` flattens templated value tokens
 * (`{LevelValuePercentMultiplyDecrease}` …) down to the bare word "value", discarding
 * whether a value should render as a flat number, an absolute value, or a percentage
 * increase/decrease. The raw UE export still carries the original tokens, so we recover
 * the per-talent token here (keyed by gameplay tag) and let the planner format
 * descriptions with the same math the component templates use.
 *
 * This lives under `$lib/server/**` so the bulky raw export never reaches the client
 * bundle — only the small derived map is serialized into the planner's page data.
 */

type RawTalentEntry = {
	Name?: string;
	TalentDescription?: string;
	TalentSupplementalDescription?: string;
};

const SUFFIX_TO_TOKEN: Record<string, ComponentValueToken> = {
	'': 'LevelValue',
	Abs: 'LevelValueAbs',
	Percent: 'LevelValuePercent',
	PercentMultiplyIncrease: 'LevelValuePercentMultiplyIncrease',
	PercentMultiplyDecrease: 'LevelValuePercentMultiplyDecrease'
};

function deriveValueToken(entry: RawTalentEntry): ComponentValueToken | undefined {
	const text = `${entry.TalentDescription ?? ''} ${entry.TalentSupplementalDescription ?? ''}`;
	const match = text.match(/\{(?:Level|Point)Value(\w*)\}/);
	if (!match) return undefined;
	return SUFFIX_TO_TOKEN[match[1]];
}

// Only non-default tokens are kept; talents without an entry fall back to flat
// `LevelValue` rendering, which matches the previous behaviour.
const tokenByTalentTag: Record<string, ComponentValueToken> = {};
for (const entry of rawTalents as RawTalentEntry[]) {
	if (!entry.Name) continue;
	const token = deriveValueToken(entry);
	if (token && token !== 'LevelValue') {
		tokenByTalentTag[entry.Name] = token;
	}
}

/**
 * Map of talent gameplay tag (`talent.key`) → value token, for talents whose displayed
 * value is something other than a flat number. Safe to serialize into page data.
 */
export function getTalentValueTokenMap(): Record<string, ComponentValueToken> {
	return tokenByTalentTag;
}
