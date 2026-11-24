export interface NotificationItem {
	id: string;
	type: string;
	title: string;
	body: string;
	link: string | null;
	readAt: string | null;
	createdAt: string;
}

const APP_PATH = /^\/(?!\/)\S{0,499}$/;

/** A same-site path the header and notification page are allowed to open. */
export function isSafeAppPath(value: string | null | undefined): value is string {
	if (!value || value.length > 500) return false;
	if (!APP_PATH.test(value)) return false;
	if (value.includes('\\') || value.includes('://')) return false;
	return true;
}

export function formatNotificationWhen(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '';
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC'
	}).format(date);
}
