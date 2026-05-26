import { describe, expect, it } from 'vitest';
import {
	computeBodySuggestionSegments,
	countChangeSegments,
	mergeSuggestions,
	type SuggestionDecision
} from './body-suggestions';

function decisionsFor(segments: ReturnType<typeof computeBodySuggestionSegments>, value: SuggestionDecision) {
	const out: Record<number, SuggestionDecision> = {};
	for (const seg of segments) if (seg.kind === 'change') out[seg.id] = value;
	return out;
}

describe('computeBodySuggestionSegments', () => {
	it('returns a single same-segment when nothing changed', () => {
		const segments = computeBodySuggestionSegments('hello world', 'hello world');
		expect(countChangeSegments(segments)).toBe(0);
		expect(segments).toEqual([{ kind: 'same', value: 'hello world' }]);
	});

	it('collapses a contiguous word change into one change segment', () => {
		const segments = computeBodySuggestionSegments('the quick brown fox', 'the slow brown fox');
		expect(countChangeSegments(segments)).toBe(1);
		const change = segments.find((s) => s.kind === 'change');
		expect(change).toMatchObject({ before: 'quick', after: 'slow' });
	});

	it('assigns contiguous zero-based ids to multiple changes', () => {
		const segments = computeBodySuggestionSegments('a b c d', 'a X c Y');
		const ids = segments.filter((s) => s.kind === 'change').map((s) => (s as { id: number }).id);
		expect(ids).toEqual([0, 1]);
	});

	it('models a pure insertion as a change with empty before', () => {
		const segments = computeBodySuggestionSegments('hello world', 'hello brave world');
		const change = segments.find((s) => s.kind === 'change');
		expect(change).toMatchObject({ before: '' });
		expect((change as { after: string }).after).toContain('brave');
	});

	it('models a pure deletion as a change with empty after', () => {
		const segments = computeBodySuggestionSegments('hello brave world', 'hello world');
		const change = segments.find((s) => s.kind === 'change');
		expect(change).toMatchObject({ after: '' });
		expect((change as { before: string }).before).toContain('brave');
	});
});

describe('mergeSuggestions', () => {
	const base = 'the quick brown fox';
	const proposed = 'the slow brown cat';

	it('keeps the author body when every change is rejected', () => {
		const segments = computeBodySuggestionSegments(base, proposed);
		expect(mergeSuggestions(segments, decisionsFor(segments, 'rejected'))).toBe(base);
	});

	it('produces the reviewer body when every change is accepted', () => {
		const segments = computeBodySuggestionSegments(base, proposed);
		expect(mergeSuggestions(segments, decisionsFor(segments, 'accepted'))).toBe(proposed);
	});

	it('treats unresolved (pending) changes as keeping the author wording', () => {
		const segments = computeBodySuggestionSegments(base, proposed);
		expect(mergeSuggestions(segments, {})).toBe(base);
	});

	it('mixes per-hunk decisions', () => {
		const segments = computeBodySuggestionSegments(base, proposed);
		// Accept the first change (quick -> slow), reject the second (fox -> cat).
		const merged = mergeSuggestions(segments, { 0: 'accepted', 1: 'rejected' });
		expect(merged).toBe('the slow brown fox');
	});

	it('round-trips multi-line markdown when all accepted', () => {
		const a = '# Title\n\nFirst paragraph.\n\nSecond paragraph.';
		const b = '# Title\n\nFirst paragraph, revised.\n\nSecond paragraph.';
		const segments = computeBodySuggestionSegments(a, b);
		expect(mergeSuggestions(segments, decisionsFor(segments, 'accepted'))).toBe(b);
		expect(mergeSuggestions(segments, decisionsFor(segments, 'rejected'))).toBe(a);
	});
});
