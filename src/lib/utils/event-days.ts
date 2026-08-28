// Day-bucketing helpers shared by the events page and its mini calendar.
// All keys are computed in the viewer's local timezone, matching how event
// times are displayed.

/** Local-timezone calendar-day key, e.g. "2026-08-07". */
export function dayKey(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

// Events are capped at 30 days server-side; this is just a defensive bound.
const MAX_SPAN_DAYS = 40;

/** Every local calendar day an event touches, from start through end. */
export function spanDayKeys(startsIso: string, endsIso: string | null): string[] {
	const start = new Date(startsIso);
	const end = endsIso ? new Date(endsIso) : start;
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

	const keys: string[] = [];
	const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
	const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
	while (cursor <= last && keys.length < MAX_SPAN_DAYS) {
		keys.push(dayKey(cursor));
		cursor.setDate(cursor.getDate() + 1);
	}
	return keys;
}
