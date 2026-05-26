import { diffWordsWithSpace } from 'diff';

/**
 * Shared logic for reviewer inline suggested edits. A reviewer's proposed body
 * is diffed against the author's submitted body; each contiguous changed region
 * becomes one accept/reject "change" segment. The author resolves each change
 * and the result is merged back into a single markdown body.
 *
 * Pure + dependency-light so it runs in the browser (the author's editor) and
 * is unit-testable without a DB.
 */

export type SuggestionDecision = 'pending' | 'accepted' | 'rejected';

export interface SameSegment {
	kind: 'same';
	value: string;
}

export interface ChangeSegment {
	kind: 'change';
	id: number;
	/** The author's original text for this region ('' for a pure insertion). */
	before: string;
	/** The reviewer's proposed text for this region ('' for a pure deletion). */
	after: string;
}

export type SuggestionSegment = SameSegment | ChangeSegment;

/**
 * Break a word-level diff of (base → proposed) into a flat list of segments.
 * Consecutive added/removed parts collapse into a single change so prose edits
 * read as one suggestion instead of a scatter of word-level toggles.
 */
export function computeBodySuggestionSegments(base: string, proposed: string): SuggestionSegment[] {
	const parts = diffWordsWithSpace(base, proposed);
	const segments: SuggestionSegment[] = [];
	let before = '';
	let after = '';
	let nextId = 0;

	const flushChange = () => {
		if (before === '' && after === '') return;
		segments.push({ kind: 'change', id: nextId++, before, after });
		before = '';
		after = '';
	};

	for (const part of parts) {
		if (part.added) {
			after += part.value;
		} else if (part.removed) {
			before += part.value;
		} else {
			flushChange();
			if (part.value) segments.push({ kind: 'same', value: part.value });
		}
	}
	flushChange();

	return segments;
}

export function countChangeSegments(segments: readonly SuggestionSegment[]): number {
	let count = 0;
	for (const seg of segments) if (seg.kind === 'change') count++;
	return count;
}

/**
 * Reassemble a markdown body from the segments and the author's decisions.
 * An accepted change uses the reviewer's text; rejected or still-pending
 * changes keep the author's original text, so an un-touched panel is a no-op.
 */
export function mergeSuggestions(
	segments: readonly SuggestionSegment[],
	decisions: Readonly<Record<number, SuggestionDecision>>
): string {
	let out = '';
	for (const seg of segments) {
		if (seg.kind === 'same') {
			out += seg.value;
		} else {
			out += decisions[seg.id] === 'accepted' ? seg.after : seg.before;
		}
	}
	return out;
}
