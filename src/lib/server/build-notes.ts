import { ContentValidationError, sanitizeArticleBody } from './content-sanitize';
import { collectStatRefErrors } from './game-data-refs';

export type RenderedBuildNotes = {
	/** Trimmed markdown source, '' when the author left notes empty. */
	notes: string;
	/**
	 * Sanitized HTML in reference form: `<aggro-stat>` elements still carry only
	 * their tank/stat attributes. Resolve live values at read time with
	 * `renderGameStatRefs`, exactly like article bodies.
	 */
	notesHtml: string;
};

/**
 * Render build-notes markdown through the same pipeline as articles/guides,
 * so build authors get GFM, callouts, YouTube embeds, links to guides, and
 * live :stat references. Throws ContentValidationError (with field "notes")
 * on unknown directives, disallowed images, or unresolvable stat refs.
 */
export async function renderBuildNotes(
	rawNotes: string | undefined,
	options: { imageHostPrefix?: string } = {}
): Promise<RenderedBuildNotes> {
	const notes = rawNotes?.trim() ?? '';
	if (!notes) return { notes: '', notesHtml: '' };

	let html: string;
	try {
		({ html } = await sanitizeArticleBody(notes, options));
	} catch (cause) {
		if (cause instanceof ContentValidationError) {
			throw new ContentValidationError('notes', cause.message);
		}
		throw cause;
	}

	const statErrors = collectStatRefErrors(html);
	if (statErrors.length > 0) {
		throw new ContentValidationError('notes', statErrors[0]);
	}

	return { notes, notesHtml: html };
}
