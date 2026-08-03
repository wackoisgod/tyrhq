import { describe, expect, it } from 'vitest';

import { validateEventCreateBody, validateEventDecisionBody } from './event-requests';
import { CommunityEventError, validateEventInput } from './events';

describe('validateEventCreateBody', () => {
	it('accepts a minimal valid body', () => {
		const result = validateEventCreateBody({
			title: 'Friday Night Custom Lobby',
			startsAt: '2026-08-10T18:00:00.000Z'
		});
		expect(result.success).toBe(true);
	});

	it('accepts a full body with nullable optionals', () => {
		const result = validateEventCreateBody({
			title: 'Clan Tournament',
			description: 'Best of three, sign up in Discord.',
			location: 'EU servers',
			url: 'https://discord.gg/tyr',
			startsAt: '2026-08-10T18:00:00.000Z',
			endsAt: '2026-08-10T21:00:00.000Z'
		});
		expect(result.success).toBe(true);
	});

	it('rejects unknown keys', () => {
		const result = validateEventCreateBody({
			title: 'Event',
			startsAt: '2026-08-10T18:00:00.000Z',
			status: 'approved'
		});
		expect(result.success).toBe(false);
	});

	it('rejects a missing title', () => {
		const result = validateEventCreateBody({ startsAt: '2026-08-10T18:00:00.000Z' });
		expect(result.success).toBe(false);
	});
});

describe('validateEventDecisionBody', () => {
	it('accepts approve and reject', () => {
		expect(validateEventDecisionBody({ decision: 'approve' }).success).toBe(true);
		expect(validateEventDecisionBody({ decision: 'reject', notes: 'Duplicate.' }).success).toBe(
			true
		);
	});

	it('rejects other decisions', () => {
		expect(validateEventDecisionBody({ decision: 'publish' }).success).toBe(false);
	});
});

describe('validateEventInput', () => {
	const now = new Date('2026-08-03T12:00:00.000Z');

	const base = {
		title: 'Friday Night Custom Lobby',
		startsAt: '2026-08-10T18:00:00.000Z'
	};

	it('normalises a valid event', () => {
		const result = validateEventInput(
			{
				...base,
				title: '  Friday Night Custom Lobby  ',
				description: ' Bring your own tank. ',
				location: ' EU servers ',
				url: 'https://discord.gg/tyr',
				endsAt: '2026-08-10T21:00:00.000Z'
			},
			now
		);
		expect(result).toEqual({
			title: 'Friday Night Custom Lobby',
			description: 'Bring your own tank.',
			location: 'EU servers',
			url: 'https://discord.gg/tyr',
			startsAt: '2026-08-10T18:00:00.000Z',
			endsAt: '2026-08-10T21:00:00.000Z'
		});
	});

	it('defaults empty optionals to null / empty string', () => {
		const result = validateEventInput({ ...base, description: null, location: '', url: '' }, now);
		expect(result.description).toBe('');
		expect(result.location).toBeNull();
		expect(result.url).toBeNull();
		expect(result.endsAt).toBeNull();
	});

	it('rejects a too-short title', () => {
		expect(() => validateEventInput({ ...base, title: 'ab' }, now)).toThrowError(
			CommunityEventError
		);
	});

	it('rejects a non-https link', () => {
		expect(() =>
			validateEventInput({ ...base, url: 'http://example.com/event' }, now)
		).toThrowError(/https/);
	});

	it('rejects an unparsable link', () => {
		expect(() => validateEventInput({ ...base, url: 'not a url' }, now)).toThrowError(
			/valid URL/
		);
	});

	it('rejects an invalid start date', () => {
		expect(() => validateEventInput({ ...base, startsAt: 'whenever' }, now)).toThrowError(
			/valid date/
		);
	});

	it('allows a start within the past-hour grace window', () => {
		const result = validateEventInput(
			{ ...base, startsAt: '2026-08-03T11:30:00.000Z' },
			now
		);
		expect(result.startsAt).toBe('2026-08-03T11:30:00.000Z');
	});

	it('rejects a start further in the past', () => {
		expect(() =>
			validateEventInput({ ...base, startsAt: '2026-08-03T09:00:00.000Z' }, now)
		).toThrowError(/future/);
	});

	it('rejects a start more than a year out', () => {
		expect(() =>
			validateEventInput({ ...base, startsAt: '2027-09-01T12:00:00.000Z' }, now)
		).toThrowError(/365 days/);
	});

	it('rejects an end before the start', () => {
		expect(() =>
			validateEventInput({ ...base, endsAt: '2026-08-10T17:00:00.000Z' }, now)
		).toThrowError(/after the start/);
	});

	it('rejects an over-long duration', () => {
		expect(() =>
			validateEventInput({ ...base, endsAt: '2026-09-30T18:00:00.000Z' }, now)
		).toThrowError(/at most 30 days/);
	});
});
