import { describe, expect, it } from 'vitest';

import { getGameDataBundle } from '$lib/data/game-data';

import { renderBuildNotes } from './build-notes';

const vehicle = getGameDataBundle().vehicles[0];

describe('renderBuildNotes', () => {
	it('returns empty output for empty or missing notes', async () => {
		expect(await renderBuildNotes(undefined)).toEqual({ notes: '', notesHtml: '' });
		expect(await renderBuildNotes('   ')).toEqual({ notes: '', notesHtml: '' });
	});

	it('renders markdown, including links to guides', async () => {
		const result = await renderBuildNotes(
			'Play like [this guide](/guides/some-guide) says.\n\n- poke\n- **retreat**'
		);

		expect(result.notes).toContain('[this guide](/guides/some-guide)');
		expect(result.notesHtml).toContain('<a href="/guides/some-guide">');
		expect(result.notesHtml).toContain('<strong>retreat</strong>');
	});

	it('keeps :stat references in reference form for live resolution', async () => {
		const result = await renderBuildNotes(
			`Base HP is :stat{tank="${vehicle.slug}" stat="health"}.`
		);

		expect(result.notesHtml).toContain('<aggro-stat');
		expect(result.notesHtml).toContain(`data-tank="${vehicle.slug}"`);
	});

	it('rejects unknown directives with a notes-field error', async () => {
		await expect(renderBuildNotes(':::hack\nboom\n:::')).rejects.toMatchObject({
			name: 'ContentValidationError',
			field: 'notes'
		});
	});

	it('rejects stat references to unknown tanks', async () => {
		await expect(
			renderBuildNotes(':stat{tank="not-a-real-tank" stat="health"}')
		).rejects.toMatchObject({ name: 'ContentValidationError', field: 'notes' });
	});

	it('drops raw HTML injection attempts', async () => {
		const result = await renderBuildNotes('hello <script>alert(1)</script> world');
		expect(result.notesHtml).not.toContain('<script');
	});
});
