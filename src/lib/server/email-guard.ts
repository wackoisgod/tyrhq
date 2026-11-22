/**
 * Email Guard Utility
 *
 * Prevents sending emails to placeholder addresses (Steam-only accounts).
 * Steam-only users have non-deliverable emails like steam_<steamid>@users.tyrhq.invalid
 */

/**
 * Check if an email address is a placeholder (non-deliverable)
 */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
	if (!email) return true;
	return email.endsWith('@users.tyrhq.invalid');
}

/**
 * Check if an email address is real and deliverable
 */
export function isDeliverableEmail(email: string | null | undefined): boolean {
	return !isPlaceholderEmail(email);
}

/**
 * Filter a list of email addresses to only deliverable ones
 */
export function filterDeliverableEmails(emails: (string | null | undefined)[]): string[] {
	return emails.filter((email): email is string => {
		return typeof email === 'string' && isDeliverableEmail(email);
	});
}

/**
 * Guard function that returns null if email is placeholder, otherwise returns the email
 * Use this when preparing to send an email
 */
export function guardEmail(email: string | null | undefined): string | null {
	if (isPlaceholderEmail(email)) {
		return null;
	}
	return email || null;
}
