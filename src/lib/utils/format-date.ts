/**
 * Medium date, short time, and a short timezone name (for example
 * "Nov 24, 2026, 9:13 AM PST").
 *
 * `dateStyle` and `timeStyle` cannot be combined with `timeZoneName` or any
 * other date-time component option. Node throws `TypeError: Invalid option`.
 */
export function formatDate(iso: string): string {
	return new Date(iso).toLocaleString([], {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZoneName: 'short'
	});
}
