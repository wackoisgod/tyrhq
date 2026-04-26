import { getSupabaseAdminClient } from './supabase-admin';

export type ProfileRole = 'user' | 'contributor' | 'admin';
export const PROFILE_ROLES: ProfileRole[] = ['user', 'contributor', 'admin'];

export interface AdminUserRow {
	id: string;
	email: string | null;
	displayName: string;
	role: ProfileRole;
	createdAt: string;
	lastSignInAt: string | null;
}

export class UserAdminError extends Error {
	readonly statusCode: number;
	constructor(message: string, statusCode = 400) {
		super(message);
		this.name = 'UserAdminError';
		this.statusCode = statusCode;
	}
}

function requireAdminClient() {
	const admin = getSupabaseAdminClient();
	if (!admin) {
		throw new UserAdminError(
			'User management requires SUPABASE_SERVICE_ROLE_KEY to be configured.',
			503
		);
	}
	return admin;
}

interface ProfileRow {
	id: string;
	display_name: string;
	role: ProfileRole;
}

const ROLE_PRIORITY: Record<ProfileRole, number> = { admin: 0, contributor: 1, user: 2 };

const SEARCH_MIN_CHARS = 3;
const SEARCH_MAX_CHARS = 120;
const SEARCH_RESULT_LIMIT = 20;
// Hard cap on how many auth users we'll scan when filtering by email. The
// Supabase admin SDK doesn't accept a server-side email filter, so we page
// and filter in JS. Capped to keep response time predictable; an admin who
// can't find a user this way can fall back to looking up the user ID in the
// Supabase dashboard.
const AUTH_SCAN_PAGES = 5;
const AUTH_SCAN_PER_PAGE = 1000;

/**
 * Returns the full set of users with elevated roles (contributor + admin).
 * Always small (no pagination needed) and avoids exposing the entire user
 * table on every admin page load. The "promote a new user" path uses the
 * search endpoint instead.
 */
export async function listElevatedUsers(): Promise<AdminUserRow[]> {
	const admin = requireAdminClient();

	const { data: profiles, error: profileError } = await admin
		.from('profiles')
		.select('id, display_name, role')
		.in('role', ['contributor', 'admin']);
	if (profileError) {
		console.error('[users] listElevatedUsers profiles failed', profileError);
		throw new UserAdminError('Could not load elevated profiles.', 500);
	}

	const rows = await Promise.all(
		((profiles as ProfileRow[]) ?? []).map((profile) => enrich(profile))
	);

	rows.sort((a, b) => {
		const byRole = ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role];
		if (byRole !== 0) return byRole;
		const aLabel = (a.displayName || a.email || a.id).toLowerCase();
		const bLabel = (b.displayName || b.email || b.id).toLowerCase();
		return aLabel.localeCompare(bLabel);
	});

	return rows;
}

/**
 * Search for users by email substring or display-name substring. Admin-only
 * via the calling endpoint. Returns at most SEARCH_RESULT_LIMIT matches.
 *
 * Security notes:
 * - The query is required to be at least SEARCH_MIN_CHARS to discourage
 *   single-character enumeration.
 * - Email matching is server-side only via the service-role admin client;
 *   never expose this RPC to non-admin sessions.
 * - We don't reveal *which* users *don't* exist (no "user not found" leak):
 *   an empty result just looks like an empty result, regardless of cause.
 */
export async function searchUsers(rawQuery: string): Promise<AdminUserRow[]> {
	const query = rawQuery.trim();
	if (query.length < SEARCH_MIN_CHARS) {
		throw new UserAdminError(
			`Search must be at least ${SEARCH_MIN_CHARS} characters.`,
			400
		);
	}
	if (query.length > SEARCH_MAX_CHARS) {
		throw new UserAdminError('Search query is too long.', 400);
	}
	const lower = query.toLowerCase();

	const admin = requireAdminClient();

	// 1) Display-name match against profiles. ILIKE is case-insensitive.
	//    Escape PostgREST special chars in the search term.
	const safe = query.replace(/[%_,]/g, (c) => `\\${c}`);
	const { data: nameMatches, error: nameError } = await admin
		.from('profiles')
		.select('id, display_name, role')
		.ilike('display_name', `%${safe}%`)
		.limit(SEARCH_RESULT_LIMIT);
	if (nameError) {
		console.error('[users] searchUsers name match failed', nameError);
		throw new UserAdminError('Search failed.', 500);
	}

	// 2) Email match — paging through auth.admin.listUsers and filtering in JS,
	//    capped at AUTH_SCAN_PAGES * AUTH_SCAN_PER_PAGE rows. Adequate for
	//    MVP-scale sites; replace with a SECURITY DEFINER RPC if it ever
	//    becomes a perf problem.
	const matchedAuthIds = new Set<string>();
	const matchedAuthUsers = new Map<
		string,
		{ id: string; email: string | null; created_at: string; last_sign_in_at: string | null }
	>();

	for (let page = 1; page <= AUTH_SCAN_PAGES; page++) {
		const { data, error: authError } = await admin.auth.admin.listUsers({
			page,
			perPage: AUTH_SCAN_PER_PAGE
		});
		if (authError) {
			console.error('[users] searchUsers auth scan failed', authError);
			throw new UserAdminError('Search failed.', 500);
		}
		const users = data?.users ?? [];
		for (const u of users) {
			if (matchedAuthIds.size >= SEARCH_RESULT_LIMIT) break;
			if (!u.email) continue;
			if (u.email.toLowerCase().includes(lower)) {
				matchedAuthIds.add(u.id);
				matchedAuthUsers.set(u.id, {
					id: u.id,
					email: u.email,
					created_at: u.created_at,
					last_sign_in_at: u.last_sign_in_at ?? null
				});
			}
		}
		if (users.length < AUTH_SCAN_PER_PAGE) break; // no more pages
		if (matchedAuthIds.size >= SEARCH_RESULT_LIMIT) break;
	}

	// 3) Merge results, dedupe, and enrich profile-only matches with auth data.
	const profileById = new Map(((nameMatches as ProfileRow[]) ?? []).map((p) => [p.id, p]));
	const allIds = new Set<string>([...profileById.keys(), ...matchedAuthIds]);

	const rows: AdminUserRow[] = [];
	for (const id of allIds) {
		if (rows.length >= SEARCH_RESULT_LIMIT) break;
		const authMatch = matchedAuthUsers.get(id);
		const profile = profileById.get(id);

		if (profile) {
			// Already-loaded profile; if we don't have its auth metadata from
			// the email scan, fetch it individually.
			if (authMatch) {
				rows.push({
					id,
					email: authMatch.email,
					displayName: profile.display_name,
					role: profile.role,
					createdAt: authMatch.created_at,
					lastSignInAt: authMatch.last_sign_in_at
				});
			} else {
				rows.push(await enrich(profile));
			}
		} else if (authMatch) {
			// Auth-only match (no profile row yet, very rare). Look up profile
			// to get role; default to 'user' if absent.
			const { data: profileRow } = await admin
				.from('profiles')
				.select('id, display_name, role')
				.eq('id', id)
				.maybeSingle<ProfileRow>();
			rows.push({
				id,
				email: authMatch.email,
				displayName: profileRow?.display_name ?? '',
				role: profileRow?.role ?? 'user',
				createdAt: authMatch.created_at,
				lastSignInAt: authMatch.last_sign_in_at
			});
		}
	}

	rows.sort((a, b) => {
		const byRole = ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role];
		if (byRole !== 0) return byRole;
		const aLabel = (a.displayName || a.email || a.id).toLowerCase();
		const bLabel = (b.displayName || b.email || b.id).toLowerCase();
		return aLabel.localeCompare(bLabel);
	});

	return rows;
}

/**
 * Update a user's role. Admin-only. Refuses to demote the last remaining
 * admin — the system always needs at least one or you'd lock yourself out
 * of role management.
 */
export async function setUserRole(
	targetId: string,
	newRole: ProfileRole,
	actor: { id: string; role: ProfileRole }
): Promise<AdminUserRow> {
	if (actor.role !== 'admin') {
		throw new UserAdminError('Only admins can manage roles.', 403);
	}
	if (!PROFILE_ROLES.includes(newRole)) {
		throw new UserAdminError(`Unknown role "${newRole}".`, 400);
	}

	const admin = requireAdminClient();

	const { data: target, error: targetError } = await admin
		.from('profiles')
		.select('id, display_name, role')
		.eq('id', targetId)
		.maybeSingle<ProfileRow>();
	if (targetError) {
		console.error('[users] setUserRole target lookup failed', targetError);
		throw new UserAdminError('Could not look up user.', 500);
	}
	if (!target) throw new UserAdminError('User not found.', 404);

	if (target.role === newRole) return enrich(target);

	if (target.role === 'admin' && newRole !== 'admin') {
		const { count, error: countError } = await admin
			.from('profiles')
			.select('id', { head: true, count: 'exact' })
			.eq('role', 'admin');
		if (countError) {
			console.error('[users] setUserRole admin count failed', countError);
			throw new UserAdminError('Could not verify admin count.', 500);
		}
		if ((count ?? 0) <= 1) {
			throw new UserAdminError(
				'Cannot demote the last admin. Promote another user to admin first.',
				409
			);
		}
	}

	const { data: updated, error: updateError } = await admin
		.from('profiles')
		.update({ role: newRole, updated_at: new Date().toISOString() })
		.eq('id', targetId)
		.select('id, display_name, role')
		.single<ProfileRow>();

	if (updateError || !updated) {
		console.error('[users] setUserRole update failed', updateError);
		throw new UserAdminError('Could not update role.', 500);
	}

	return enrich(updated);
}

async function enrich(profile: ProfileRow): Promise<AdminUserRow> {
	const admin = requireAdminClient();
	const { data: authUser } = await admin.auth.admin.getUserById(profile.id);
	const u = authUser?.user;
	return {
		id: profile.id,
		email: u?.email ?? null,
		displayName: profile.display_name,
		role: profile.role,
		createdAt: u?.created_at ?? '',
		lastSignInAt: u?.last_sign_in_at ?? null
	};
}
