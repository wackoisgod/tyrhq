// Predefined headings under which guides/articles can surface in the
// Resources nav flyout. Adding a new section is a one-line code change here;
// the value is validated at the API boundary (Zod) and used as the dropdown
// source on both contributor and admin forms.
//
// FLYOUT_SECTION_ORDER controls the display order of *new* columns appended
// to the flyout — sections that share a heading with an existing static
// column (e.g. "Database", "World" in site.ts) merge into that column
// instead.

export const FLYOUT_SECTIONS = ['Mechanics'] as const;
export type FlyoutSection = (typeof FLYOUT_SECTIONS)[number];

export const FLYOUT_SECTION_ORDER: readonly FlyoutSection[] = ['Mechanics'];

export function isFlyoutSection(value: unknown): value is FlyoutSection {
	return typeof value === 'string' && (FLYOUT_SECTIONS as readonly string[]).includes(value);
}
