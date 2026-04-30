import { diffWordsWithSpace } from 'diff';
import type { ArticleDetail } from './articles';
import type { SubmissionRecord } from './submissions';

export type DiffChunkKind = 'same' | 'add' | 'del';
export interface DiffChunk {
	value: string;
	kind: DiffChunkKind;
}

export type FieldDeltaKind = 'changed' | 'added' | 'removed';

export interface ScalarFieldDelta {
	field: string;
	label: string;
	kind: FieldDeltaKind;
	before: string | null;
	after: string | null;
}

export interface ListFieldDelta {
	field: string;
	label: string;
	kind: 'list';
	added: string[];
	removed: string[];
}

export type FieldDelta = ScalarFieldDelta | ListFieldDelta;

export interface ArticleDiff {
	bodyChunks: DiffChunk[];
	fieldDeltas: FieldDelta[];
	bodyChanged: boolean;
}

function normalizeString(value: string | null | undefined): string {
	return (value ?? '').trim();
}

function scalarDelta(
	field: string,
	label: string,
	before: string | null | undefined,
	after: string | null | undefined
): ScalarFieldDelta | null {
	const a = normalizeString(before);
	const b = normalizeString(after);
	if (a === b) return null;
	let kind: FieldDeltaKind = 'changed';
	if (!a && b) kind = 'added';
	else if (a && !b) kind = 'removed';
	return {
		field,
		label,
		kind,
		before: a || null,
		after: b || null
	};
}

function listDelta(
	field: string,
	label: string,
	before: readonly string[] | null | undefined,
	after: readonly string[] | null | undefined
): ListFieldDelta | null {
	const a = new Set((before ?? []).map((v) => v.trim()).filter(Boolean));
	const b = new Set((after ?? []).map((v) => v.trim()).filter(Boolean));
	const added = [...b].filter((v) => !a.has(v)).sort();
	const removed = [...a].filter((v) => !b.has(v)).sort();
	if (!added.length && !removed.length) return null;
	return { field, label, kind: 'list', added, removed };
}

export function computeArticleDiff(
	parent: ArticleDetail,
	submission: SubmissionRecord
): ArticleDiff {
	const fieldDeltas: FieldDelta[] = [];

	const scalarSpecs: Array<[string, string, string | null | undefined, string | null | undefined]> = [
		['title', 'Title', parent.title, submission.title],
		['summary', 'Summary', parent.summary, submission.summary],
		['slug', 'Slug', parent.slug, submission.slug],
		['heroImageUrl', 'Hero image', parent.heroImageUrl, submission.hero_image_url],
		['flyoutSection', 'Flyout section', parent.flyoutSection, submission.flyout_section]
	];
	for (const [field, label, before, after] of scalarSpecs) {
		const delta = scalarDelta(field, label, before, after);
		if (delta) fieldDeltas.push(delta);
	}

	const tagsDelta = listDelta('tags', 'Tags', parent.tags, submission.tags);
	if (tagsDelta) fieldDeltas.push(tagsDelta);
	const vehiclesDelta = listDelta(
		'vehicleSlugs',
		'Vehicles',
		parent.vehicleSlugs,
		submission.vehicle_slugs
	);
	if (vehiclesDelta) fieldDeltas.push(vehiclesDelta);

	const before = parent.bodyMarkdown ?? '';
	const after = submission.body_markdown ?? '';
	const bodyChunks: DiffChunk[] =
		before === after
			? [{ value: after, kind: 'same' }]
			: diffWordsWithSpace(before, after).map((part) => ({
					value: part.value,
					kind: part.added ? 'add' : part.removed ? 'del' : 'same'
				}));

	return {
		bodyChunks,
		fieldDeltas,
		bodyChanged: before !== after
	};
}
