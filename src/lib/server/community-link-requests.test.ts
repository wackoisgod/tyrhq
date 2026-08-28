import { describe, expect, it } from 'vitest';

import {
	validateGroupBody,
	validateLinkCreateBody,
	validateLinkUpdateBody,
	validateMoveBody
} from './community-link-requests';
import {
	CommunityLinkError,
	reorderSiblings,
	validateGroupInput,
	validateLinkInput
} from './community-links';

const GROUP_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('validateGroupBody', () => {
	it('accepts a minimal body', () => {
		expect(validateGroupBody({ heading: 'Sites & Tools' }).success).toBe(true);
	});

	it('accepts a null annotation', () => {
		expect(validateGroupBody({ heading: 'Sites & Tools', annotation: null }).success).toBe(true);
	});

	it('rejects unknown keys', () => {
		expect(validateGroupBody({ heading: 'Sites', position: 0 }).success).toBe(false);
	});

	it('rejects a missing heading', () => {
		expect(validateGroupBody({ annotation: 'FAN-MADE' }).success).toBe(false);
	});
});

describe('validateLinkCreateBody', () => {
	it('accepts a full body', () => {
		const result = validateLinkCreateBody({
			groupId: GROUP_ID,
			label: 'Tyr Wiki',
			href: 'https://example.com',
			description: 'Community-maintained wiki.',
			tag: 'Wiki'
		});
		expect(result.success).toBe(true);
	});

	it('rejects a groupId that is not a uuid', () => {
		const result = validateLinkCreateBody({
			groupId: 'official-channels',
			label: 'Tyr Wiki',
			href: 'https://example.com'
		});
		expect(result.success).toBe(false);
	});

	it('rejects a missing href', () => {
		expect(validateLinkCreateBody({ groupId: GROUP_ID, label: 'Tyr Wiki' }).success).toBe(false);
	});
});

describe('validateLinkUpdateBody', () => {
	it('accepts a body without a groupId', () => {
		const result = validateLinkUpdateBody({ label: 'Tyr Wiki', href: 'https://example.com' });
		expect(result.success).toBe(true);
	});

	it('rejects a groupId — links do not move between groups', () => {
		const result = validateLinkUpdateBody({
			groupId: GROUP_ID,
			label: 'Tyr Wiki',
			href: 'https://example.com'
		});
		expect(result.success).toBe(false);
	});
});

describe('validateMoveBody', () => {
	it('accepts up and down', () => {
		expect(validateMoveBody({ direction: 'up' }).success).toBe(true);
		expect(validateMoveBody({ direction: 'down' }).success).toBe(true);
	});

	it('rejects any other direction', () => {
		expect(validateMoveBody({ direction: 'top' }).success).toBe(false);
	});
});

describe('validateGroupInput', () => {
	it('trims and keeps the heading', () => {
		expect(validateGroupInput({ heading: '  Official Channels  ' })).toEqual({
			heading: 'Official Channels',
			annotation: null
		});
	});

	it('normalises a blank annotation to null', () => {
		expect(validateGroupInput({ heading: 'Official Channels', annotation: '   ' }).annotation).toBe(
			null
		);
	});

	it('rejects a heading that is too short', () => {
		expect(() => validateGroupInput({ heading: 'A' })).toThrow(CommunityLinkError);
	});

	it('rejects a heading that is too long', () => {
		expect(() => validateGroupInput({ heading: 'x'.repeat(81) })).toThrow(CommunityLinkError);
	});

	it('rejects an annotation that is too long', () => {
		expect(() =>
			validateGroupInput({ heading: 'Official Channels', annotation: 'x'.repeat(41) })
		).toThrow(CommunityLinkError);
	});
});

describe('validateLinkInput', () => {
	const base = { label: 'Tyr Discord', href: 'https://discord.com/invite/tyr' };

	it('normalises optional fields to null', () => {
		expect(validateLinkInput({ ...base, description: '  ', tag: '' })).toEqual({
			label: 'Tyr Discord',
			href: 'https://discord.com/invite/tyr',
			description: null,
			tag: null
		});
	});

	it('rejects http links', () => {
		expect(() => validateLinkInput({ ...base, href: 'http://example.com' })).toThrow(
			CommunityLinkError
		);
	});

	it('rejects javascript: links', () => {
		expect(() => validateLinkInput({ ...base, href: 'javascript:alert(1)' })).toThrow(
			CommunityLinkError
		);
	});

	it('rejects a malformed URL', () => {
		expect(() => validateLinkInput({ ...base, href: 'discord.gg/tyr' })).toThrow(
			CommunityLinkError
		);
	});

	it('rejects a blank href', () => {
		expect(() => validateLinkInput({ ...base, href: '   ' })).toThrow(CommunityLinkError);
	});

	it('rejects a label that is too short', () => {
		expect(() => validateLinkInput({ ...base, label: 'x' })).toThrow(CommunityLinkError);
	});

	it('rejects a description that is too long', () => {
		expect(() => validateLinkInput({ ...base, description: 'x'.repeat(301) })).toThrow(
			CommunityLinkError
		);
	});

	it('rejects a tag that is too long', () => {
		expect(() => validateLinkInput({ ...base, tag: 'x'.repeat(25) })).toThrow(CommunityLinkError);
	});

	it('surfaces problems as 422s so the admin form can show them', () => {
		try {
			validateLinkInput({ ...base, href: 'http://example.com' });
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(err).toBeInstanceOf(CommunityLinkError);
			expect((err as CommunityLinkError).statusCode).toBe(422);
		}
	});
});

describe('reorderSiblings', () => {
	const rows = ['a', 'b', 'c'];

	it('swaps with the previous row', () => {
		expect(reorderSiblings(rows, 1, 'up')).toEqual(['b', 'a', 'c']);
	});

	it('swaps with the next row', () => {
		expect(reorderSiblings(rows, 1, 'down')).toEqual(['a', 'c', 'b']);
	});

	it('is a no-op at the top', () => {
		expect(reorderSiblings(rows, 0, 'up')).toEqual(rows);
	});

	it('is a no-op at the bottom', () => {
		expect(reorderSiblings(rows, 2, 'down')).toEqual(rows);
	});

	it('is a no-op for a row that is not in the list', () => {
		expect(reorderSiblings(rows, -1, 'down')).toEqual(rows);
	});
});
