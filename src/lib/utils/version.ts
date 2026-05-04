/**
 * Compare two version strings descending (highest version first), tolerant of
 * the patch-note input shapes contributors are likely to use:
 *   v0.5.2, 0.5.2, v0.5.10, v0.5.2-rc1, v0.5.2-hotfix
 *
 * Numeric segments compare numerically (so v0.5.10 > v0.5.2). A pre-release
 * suffix (anything after the numeric run) sorts BEFORE the bare release
 * (v0.5.2-rc1 < v0.5.2), matching SemVer.
 *
 * Returns 0 when either version is null/empty so callers can apply a
 * date-based tiebreaker without losing rows that have no version at all.
 */
export function compareVersionsDesc(a: string | null, b: string | null): number {
	if (!a && !b) return 0;
	if (!a) return 1;
	if (!b) return -1;

	const pa = parseVersion(a);
	const pb = parseVersion(b);
	const len = Math.max(pa.length, pb.length);

	for (let i = 0; i < len; i++) {
		const va = pa[i];
		const vb = pb[i];
		// A shorter run of numeric segments sorts higher (release > pre-release).
		if (va === undefined) return -1;
		if (vb === undefined) return 1;

		const aIsNum = typeof va === 'number';
		const bIsNum = typeof vb === 'number';
		if (aIsNum && bIsNum) {
			if (va !== vb) return (vb as number) - (va as number);
		} else if (aIsNum) {
			return -1;
		} else if (bIsNum) {
			return 1;
		} else {
			const cmp = (vb as string).localeCompare(va as string);
			if (cmp !== 0) return cmp;
		}
	}
	return 0;
}

function parseVersion(input: string): Array<number | string> {
	return input
		.trim()
		.replace(/^v/i, '')
		.split(/[.\-_+]/)
		.filter(Boolean)
		.map((segment) => {
			const n = Number.parseInt(segment, 10);
			return Number.isNaN(n) ? segment : n;
		});
}
