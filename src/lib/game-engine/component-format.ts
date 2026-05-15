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
			isComponentValueToken(token) ? formatMagnitude(resolveComponentToken(token, value)) : match
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
	return cleaned.replace(/\bvalue\b/gi, () => formatMagnitude(value));
}

export function fillComponentDescription(description: string, pointValues: number[]): string {
	const cleaned = fillTemplatedComponentDescription(description, pointValues);
	return fillGeneratedComponentDescription(cleaned, pointValues);
}
