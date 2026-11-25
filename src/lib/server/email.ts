import { env } from '$env/dynamic/private';

export interface OutboundEmail {
	to: string;
	subject: string;
	text: string;
}

export type SendEmailResult =
	| { delivered: true }
	| { delivered: false; reason: 'not_configured' | 'provider_error' | 'request_failed' };

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

/**
 * Organizer approve and reject mail. Both RESEND_API_KEY and EMAIL_FROM must
 * be set or this stays a no-op. A failed send returns delivered: false and
 * does not throw, so the in-app notice and the decision still stand.
 */
type MailSettingName = 'RESEND_API_KEY' | 'EMAIL_FROM';

function mailSettings(): { apiKey: string; from: string; missing: MailSettingName[] } {
	const apiKey = env.RESEND_API_KEY?.trim() ?? '';
	const from = env.EMAIL_FROM?.trim() ?? '';
	const missing: MailSettingName[] = [];
	if (!apiKey) missing.push('RESEND_API_KEY');
	if (!from) missing.push('EMAIL_FROM');
	return { apiKey, from, missing };
}

function mailConfig(): { apiKey: string; from: string } | null {
	const settings = mailSettings();
	if (settings.missing.length > 0) return null;
	return { apiKey: settings.apiKey, from: settings.from };
}

export function isTransactionalEmailConfigured(): boolean {
	return mailConfig() !== null;
}

function redact(value: string, secret: string): string {
	if (!secret) return value;
	return value.split(secret).join('[redacted]');
}

function logSendFailure(apiKey: string, status: number | null, detail: string) {
	console.error('[email] send failed', {
		status,
		detail: redact(detail, apiKey).slice(0, 300)
	});
}

async function responseDetail(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch {
		return '';
	}
}

export async function sendEmail(message: OutboundEmail): Promise<SendEmailResult> {
	if (!message.to.trim() || !message.subject.trim() || !message.text.trim()) {
		throw new Error('Email needs a recipient, subject, and text.');
	}

	const settings = mailSettings();
	if (settings.missing.length > 0) {
		console.warn('[email] not configured; skipping send', { missing: settings.missing });
		return { delivered: false, reason: 'not_configured' };
	}

	try {
		const response = await fetch(RESEND_EMAILS_URL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${settings.apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				from: settings.from,
				to: message.to.trim(),
				subject: message.subject.trim(),
				text: message.text.trim()
			})
		});

		if (!response.ok) {
			logSendFailure(settings.apiKey, response.status, await responseDetail(response));
			return { delivered: false, reason: 'provider_error' };
		}

		return { delivered: true };
	} catch (err) {
		const detail = err instanceof Error ? err.message : 'request failed';
		logSendFailure(settings.apiKey, null, detail);
		return { delivered: false, reason: 'request_failed' };
	}
}
