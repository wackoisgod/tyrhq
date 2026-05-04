export const NEW_WINDOW_DAYS = 7;

export function isRecentlyPublished(publishedAtIso: string, days = NEW_WINDOW_DAYS): boolean {
	if (!publishedAtIso) return false;
	const published = Date.parse(publishedAtIso);
	if (Number.isNaN(published)) return false;
	const ageMs = Date.now() - published;
	return ageMs >= 0 && ageMs <= days * 24 * 60 * 60 * 1000;
}
