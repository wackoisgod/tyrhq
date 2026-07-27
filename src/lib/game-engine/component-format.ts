export function plainComponentDescription(raw: string): string {
	if (!raw) return '';
	return raw
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function formatComponentCategory(category: string): string {
	return category.replace(/^Category\s+/i, '');
}

export type ComponentValueToken =
	| 'LevelValue'
	| 'LevelValueAbs'
	| 'LevelValuePercent'
	| 'LevelValuePercentMultiplyDecrease'
	| 'LevelValuePercentMultiplyIncrease';

function formatMagnitude(n: number): string {
	const abs = Math.abs(n);
	if (abs >= 100) return String(Math.round(n));
	if (abs >= 1 && abs === Math.round(abs)) return String(n);
	const s = n.toFixed(2).replace(/\.?0+$/, '');
	return s === '-0' ? '0' : s;
}

function isPercentToken(token: ComponentValueToken): boolean {
	return (
		token === 'LevelValuePercent' ||
		token === 'LevelValuePercentMultiplyIncrease' ||
		token === 'LevelValuePercentMultiplyDecrease'
	);
}

function formatTokenValue(token: ComponentValueToken, value: number): string {
	if (isPercentToken(token)) {
		return `${formatMagnitude(value * 100)}%`;
	}
	return formatMagnitude(value);
}

function resolveComponentToken(token: ComponentValueToken, value: number): number {
	switch (token) {
		case 'LevelValueAbs':
			return Math.abs(value);
		case 'LevelValuePercentMultiplyDecrease':
			return 1 - value;
		case 'LevelValuePercentMultiplyIncrease':
			return value - 1;
		case 'LevelValue':
		case 'LevelValuePercent':
		default:
			return value;
	}
}

function isComponentValueToken(token: string): token is ComponentValueToken {
	return (
		token === 'LevelValue' ||
		token === 'LevelValueAbs' ||
		token === 'LevelValuePercent' ||
		token === 'LevelValuePercentMultiplyDecrease' ||
		token === 'LevelValuePercentMultiplyIncrease'
	);
}

export function fillTemplatedComponentDescription(description: string, pointValues: number[]): string {
	const cleaned = plainComponentDescription(description);
	if (!pointValues.length) return cleaned;
	const value = pointValues[0];

	return cleaned.replace(
		/\{(LevelValue(?:Abs|Percent(?:Multiply(?:Decrease|Increase))?)?)\}/g,
		(match: string, token: string) =>
			isComponentValueToken(token)
				? formatTokenValue(token, resolveComponentToken(token, value))
				: match
	);
}

export function fillGeneratedComponentDescription(
	description: string,
	pointValues: number[],
	token: ComponentValueToken = 'LevelValue'
): string {
	const cleaned = plainComponentDescription(description);
	if (!pointValues.length) return cleaned;
	if (!/\bvalue\b/i.test(cleaned)) return cleaned;
	const value = resolveComponentToken(token, pointValues[0]);
	return cleaned.replace(/\bvalue\b/gi, () => formatTokenValue(token, value));
}

export function fillComponentDescription(description: string, pointValues: number[]): string {
	const cleaned = fillTemplatedComponentDescription(description, pointValues);
	return fillGeneratedComponentDescription(cleaned, pointValues);
}

export type TalentValueToken =
	| ComponentValueToken
	| 'PointValue'
	| 'PointValueAbs'
	| 'PointValuePercent'
	| 'PointValuePercentMultiplyDecrease'
	| 'PointValuePercentMultiplyIncrease';

const talentTokenPattern = /\{((?:Level|Point)Value(?:Abs|Percent(?:Multiply(?:Decrease|Increase))?)?)\}/g;

/** Point* tokens substitute the per-point delta; Level* tokens the cumulative value. */
export function isPerPointToken(token: TalentValueToken): boolean {
	return token.startsWith('Point');
}

function toLevelToken(token: TalentValueToken): ComponentValueToken {
	return (
		token.startsWith('Point') ? `Level${token.slice('Point'.length)}` : token
	) as ComponentValueToken;
}

/** Ordered placeholder tokens from a raw (untranslated) talent description. */
export function extractTalentValueTokens(rawDescription: string): TalentValueToken[] {
	return Array.from(
		rawDescription.matchAll(talentTokenPattern),
		(match) => match[1] as TalentValueToken
	);
}

export function formatTalentTokenValue(token: TalentValueToken, value: number): string {
	const levelToken = toLevelToken(token);
	return formatTokenValue(levelToken, resolveComponentToken(levelToken, value));
}

/**
 * Fill a runtime talent description whose placeholders were flattened to the literal
 * word "value". Each occurrence is resolved through the talent's original token list
 * (recovered from the raw data drop) so percent/absolute/multiplier values render on
 * the same scale the game shows.
 */
export function fillTalentDescription(
	description: string,
	pointValues: number[],
	valueTokens: TalentValueToken[],
	currentPoints: number,
	nodeMaxPoints: number
): string {
	const cleaned = plainComponentDescription(description);
	if (!pointValues.length) return cleaned;

	const perPoint = pointValues[0];
	// When unallocated, preview the value at the node's cap — pointValues may extend
	// past the node's maxPoints (e.g. Sonar Max Energy: pointValues=[10,20,30,40,50]
	// but the node only allows 3 points, so the previewed max should be 30, not 50).
	const previewIndex =
		currentPoints > 0
			? Math.min(currentPoints, pointValues.length)
			: Math.min(nodeMaxPoints, pointValues.length);
	const levelValue = pointValues[Math.max(1, previewIndex) - 1];

	let occurrence = 0;
	return cleaned.replace(/\bvalue\b/gi, (match) => {
		const index = occurrence++;
		const token = valueTokens[index];
		if (token) {
			return formatTalentTokenValue(token, isPerPointToken(token) ? perPoint : levelValue);
		}
		// Token list exhausted mid-description: leave the text untouched rather than guess.
		if (valueTokens.length > 0) return match;
		// No token data for this talent at all — legacy plain-number formatting.
		return formatMagnitude(index === 0 ? levelValue : perPoint);
	});
}
