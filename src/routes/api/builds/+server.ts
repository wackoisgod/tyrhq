import { randomInt } from 'node:crypto';

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createBuildBodySchema,
	deleteBuildBodySchema,
	isMissingBuildNotesColumnError,
	normalizeBuildTitle,
	parseJsonBody,
	updateBuildBodySchema
} from '$lib/server/build-requests';
import { renderBuildNotes, type RenderedBuildNotes } from '$lib/server/build-notes';
import { ContentValidationError } from '$lib/server/content-sanitize';

function generateSlug(): string {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let slug = '';
	for (let i = 0; i < 8; i++) {
		slug += chars[randomInt(chars.length)];
	}
	return slug;
}

function failBuildsRequest(message: string, cause: unknown) {
	console.error(`[builds-api] ${message}`, cause);
	return error(500, 'Builds are unavailable right now');
}

/** Render notes markdown to sanitized HTML, mapping author mistakes to a 400. */
async function renderBuildNotesOrFail(rawNotes: string | undefined): Promise<RenderedBuildNotes> {
	try {
		return await renderBuildNotes(rawNotes);
	} catch (cause) {
		if (cause instanceof ContentValidationError) {
			error(400, `notes: ${cause.message}`);
		}
		throw cause;
	}
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return error(401, 'Authentication required');

	const body = await parseJsonBody(request, createBuildBodySchema);

	const slug = generateSlug();

	const noteContent = await renderBuildNotesOrFail(body.notes);
	const insertRow = {
		user_id: user.id,
		slug,
		title: normalizeBuildTitle(body.title),
		vehicle_id: body.vehicleId,
		selection: body.selection,
		is_public: body.isPublic ?? false
	};

	let { data, error: dbError } = await locals.supabase
		.from('builds')
		.insert({ ...insertRow, notes: noteContent.notes, notes_html: noteContent.notesHtml })
		.select()
		.single();

	if (dbError && isMissingBuildNotesColumnError(dbError)) {
		// Database has not run migration 017 yet — save without notes
		({ data, error: dbError } = await locals.supabase
			.from('builds')
			.insert(insertRow)
			.select()
			.single());
	}

	if (dbError) return failBuildsRequest('Failed to create build', dbError);
	return json(data, { status: 201 });
};

export const GET: RequestHandler = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return error(401, 'Authentication required');

	const { data, error: dbError } = await locals.supabase
		.from('builds')
		.select('id, slug, title, vehicle_id, is_public, created_at, updated_at')
		.eq('user_id', user.id)
		.order('updated_at', { ascending: false });

	if (dbError) return failBuildsRequest('Failed to list builds', dbError);
	return json(data);
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return error(401, 'Authentication required');

	const body = await parseJsonBody(request, updateBuildBodySchema);

	const noteContent = await renderBuildNotesOrFail(body.notes);
	const updateRow = {
		title: normalizeBuildTitle(body.title),
		vehicle_id: body.vehicleId,
		selection: body.selection,
		is_public: body.isPublic ?? false,
		updated_at: new Date().toISOString()
	};

	let { data, error: dbError } = await locals.supabase
		.from('builds')
		.update({ ...updateRow, notes: noteContent.notes, notes_html: noteContent.notesHtml })
		.eq('id', body.id)
		.eq('user_id', user.id)
		.select()
		.single();

	if (dbError && isMissingBuildNotesColumnError(dbError)) {
		// Database has not run migration 017 yet — save without notes
		({ data, error: dbError } = await locals.supabase
			.from('builds')
			.update(updateRow)
			.eq('id', body.id)
			.eq('user_id', user.id)
			.select()
			.single());
	}

	if (dbError) return failBuildsRequest('Failed to update build', dbError);
	return json(data);
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return error(401, 'Authentication required');

	const body = await parseJsonBody(request, deleteBuildBodySchema);

	const { error: dbError } = await locals.supabase
		.from('builds')
		.delete()
		.eq('id', body.id)
		.eq('user_id', user.id);

	if (dbError) return failBuildsRequest('Failed to delete build', dbError);
	return json({ success: true });
};
