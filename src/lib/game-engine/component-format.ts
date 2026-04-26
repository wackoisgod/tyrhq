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

function formatMagnitude(n: number): string {
	const abs = Math.abs(n);
	if (abs >= 100) return String(Math.round(n));
	if (abs >= 1 && abs === Math.round(abs)) return String(n);
	const s = n.toFixed(2).replace(/\.?0+$/, '');
	return s === '-0' ? '0' : s;
}

export function fillComponentDescription(description: string, pointValues: number[]): string {
	const cleaned = plainComponentDescription(description);
	if (!pointValues.length) return cleaned;
	const value = pointValues[0];
	if (!/\bvalue\b/i.test(cleaned)) return cleaned;
	return cleaned.replace(/\bvalue\b/gi, () => formatMagnitude(value));
}
