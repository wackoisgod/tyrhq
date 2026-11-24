export interface OutboundEmail {
	to: string;
	subject: string;
	text: string;
}

export type SendEmailResult = { delivered: true } | { delivered: false; reason: 'not_configured' };

/**
 * Product mail is not wired up.
 *
 * This repo has no transactional provider: no Resend, SMTP, nodemailer, or
 * similar helper, and no mail env vars. Supabase Auth still sends its own
 * sign-in messages. This hook is the place for product mail.
 *
 * To turn it on:
 * 1. Add a provider. Resend is enough: POST https://api.resend.com/emails
 *    with header Authorization: Bearer $RESEND_API_KEY and JSON
 *    { from, to, subject, text }.
 * 2. Set server env RESEND_API_KEY and EMAIL_FROM (a verified sender).
 *    Do not commit either value.
 * 3. Make isTransactionalEmailConfigured() true only when both are set,
 *    and replace the no-op below with that request. Approve and reject
 *    already call sendEmail with { to, subject, text }.
 */
export function isTransactionalEmailConfigured(): boolean {
	return false;
}

export async function sendEmail(message: OutboundEmail): Promise<SendEmailResult> {
	if (!message.to.trim() || !message.subject.trim() || !message.text.trim()) {
		throw new Error('Email needs a recipient, subject, and text.');
	}
	if (!isTransactionalEmailConfigured()) {
		return { delivered: false, reason: 'not_configured' };
	}
	return { delivered: true };
}
