import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	createTournament,
	createTournamentSchema,
	listManagedTournaments,
	loadOrganizerFlag,
	TournamentError
} from '$lib/server/tournaments';

function datetimeLocalToIso(value: FormDataEntryValue | null) {
	const raw = String(value ?? '').trim();
	if (!raw) return '';
	const time = new Date(raw).getTime();
	return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const { session, user, role } = await locals.safeGetSession();
	if (!session || !user) redirect(303, `/auth?next=${encodeURIComponent(url.pathname)}`);

	const isOrganizer = await loadOrganizerFlag(locals, user.id);
	if (role !== 'admin' && !isOrganizer) {
		return { isOrganizer, tournaments: [], accessDenied: true };
	}

	return {
		isOrganizer,
		accessDenied: false,
		tournaments: await listManagedTournaments(user.id, { role, isOrganizer })
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const { session, user, role } = await locals.safeGetSession();
		if (!session || !user) return fail(401, { error: 'Authentication required' });
		const isOrganizer = await loadOrganizerFlag(locals, user.id);
		const form = await request.formData();
		const parsed = createTournamentSchema.safeParse({
			name: String(form.get('name') ?? ''),
			summary: String(form.get('summary') ?? ''),
			startsAt: datetimeLocalToIso(form.get('startsAt')),
			registrationClosesAt: datetimeLocalToIso(form.get('registrationClosesAt')),
			registrationMode: String(form.get('registrationMode') ?? 'open'),
			teamSize: 8,
			substituteCount: Number(form.get('substituteCount') ?? 1),
			rulesUrl: String(form.get('rulesUrl') ?? ''),
			discordUrl: String(form.get('discordUrl') ?? '')
		});
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid tournament' });
		}

		try {
			const tournament = await createTournament(parsed.data, user.id, { role, isOrganizer });
			redirect(303, `/tournaments/${tournament.slug}`);
		} catch (err) {
			if (err instanceof TournamentError) return fail(err.statusCode, { error: err.message });
			throw err;
		}
	}
};
