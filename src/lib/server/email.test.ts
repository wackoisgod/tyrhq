import { describe, expect, it } from 'vitest';

import { isTransactionalEmailConfigured, sendEmail } from './email';

describe('sendEmail', () => {
	it('no-ops until a transactional provider is configured', async () => {
		expect(isTransactionalEmailConfigured()).toBe(false);
		await expect(
			sendEmail({
				to: 'pilot@example.com',
				subject: 'Organizer application approved',
				text: 'You can publish a tournament now.'
			})
		).resolves.toEqual({ delivered: false, reason: 'not_configured' });
	});

	it('refuses an empty message', async () => {
		await expect(sendEmail({ to: '', subject: 'Hi', text: 'Hello' })).rejects.toThrow(/recipient/);
	});
});
