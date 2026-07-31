import { describe, expect, it } from 'vitest';

import { freeAgentProfileSchema } from './tournament-participation';
import { reopenRegistrationSchema } from './tournaments';

describe('tournament participation validation', () => {
	it('normalizes an optional free-agent profile', () => {
		expect(
			freeAgentProfileSchema.parse({
				preferredRole: '  Flex  ',
				note: '  Available for every round.  '
			})
		).toEqual({ preferredRole: 'Flex', note: 'Available for every round.' });
	});

	it('limits public free-agent profile text', () => {
		expect(
			freeAgentProfileSchema.safeParse({ preferredRole: 'x'.repeat(81), note: '' }).success
		).toBe(false);
		expect(
			freeAgentProfileSchema.safeParse({ preferredRole: '', note: 'x'.repeat(281) }).success
		).toBe(false);
	});

	it('requires an offset-aware registration reopening deadline', () => {
		expect(reopenRegistrationSchema.safeParse({ closesAt: '2026-08-01T18:00:00.000Z' }).success).toBe(true);
		expect(reopenRegistrationSchema.safeParse({ closesAt: '2026-08-01T18:00' }).success).toBe(false);
	});
});
