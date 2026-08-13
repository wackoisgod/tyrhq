import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseJsonBody } from '$lib/server/build-requests';
import { upsertTankNoteBodySchema } from '$lib/server/tank-note-requests';

function failTankNotesRequest(message: string, cause: unknown) {
	console.error(`[tank-notes-api] ${message}`, cause);
	return error(500, 'Tank notes are unavailable right now');
}

export const GET: RequestHandler = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return error(401, 'Authentication required');

	const { data, error: dbError } = await locals.supabase
		.from('tank_notes')
		.select('vehicle_id, notes, updated_at')
		.eq('user_id', user.id);

	if (dbError) return failTankNotesRequest('Failed to list tank notes', dbError);
	return json(data);
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return error(401, 'Authentication required');

	const body = await parseJsonBody(request, upsertTankNoteBodySchema);

	// Clearing the notepad removes the row instead of storing an empty note
	if (!body.notes) {
		const { error: dbError } = await locals.supabase
			.from('tank_notes')
			.delete()
			.eq('user_id', user.id)
			.eq('vehicle_id', body.vehicleId);

		if (dbError) return failTankNotesRequest('Failed to clear tank note', dbError);
		return json({ vehicle_id: body.vehicleId, notes: '' });
	}

	const { data, error: dbError } = await locals.supabase
		.from('tank_notes')
		.upsert(
			{
				user_id: user.id,
				vehicle_id: body.vehicleId,
				notes: body.notes,
				updated_at: new Date().toISOString()
			},
			{ onConflict: 'user_id,vehicle_id' }
		)
		.select('vehicle_id, notes, updated_at')
		.single();

	if (dbError) return failTankNotesRequest('Failed to save tank note', dbError);
	return json(data);
};
