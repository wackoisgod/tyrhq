import { getSupabaseAdminClient } from './supabase-admin';
import { communityGroups as fallbackGroups, type CommunityGroup } from '$lib/content/community';
import type { ProfileRole } from './users';

export interface CommunityLinkRecord {
	id: string;
	group_id: string;
	label: string;
	href: string;
	description: string | null;
	tag: string | null;
	position: number;
	created_at: string;
	updated_at: string;
}

export interface CommunityLinkGroupRecord {
	id: string;
	heading: string;
	annotation: string | null;
	position: number;
	created_at: string;
	updated_at: string;
	links: CommunityLinkRecord[];
}

const GROUP_COLUMNS = 'id, heading, annotation, position, created_at, updated_at';
const LINK_COLUMNS =
	'id, group_id, label, href, description, tag, position, created_at, updated_at';

export class CommunityLinkError extends Error {
	readonly statusCode: number;
	constructor(message: string, statusCode = 400) {
		super(message);
		this.name = 'CommunityLinkError';
		this.statusCode = statusCode;
	}
}

function requireAdminClient() {
	const admin = getSupabaseAdminClient();
	if (!admin) {
		throw new CommunityLinkError(
			'Community links require SUPABASE_SERVICE_ROLE_KEY to be configured.',
			503
		);
	}
	return admin;
}

/**
 * Curating the public link directory is an admin job, like role management —
 * reviewers moderate what users submit, admins decide what the site itself
 * points at.
 */
export function assertCanCurate(actor: { role: ProfileRole }): void {
	if (actor.role !== 'admin') {
		throw new CommunityLinkError('Admin role required.', 403);
	}
}

export const COMMUNITY_LINK_LIMITS = {
	headingMin: 2,
	headingMax: 80,
	annotationMax: 40,
	labelMin: 2,
	labelMax: 120,
	hrefMax: 1024,
	descriptionMax: 300,
	tagMax: 24
} as const;

export interface CommunityGroupInput {
	heading: string;
	annotation?: string | null;
}

export interface ValidatedGroupInput {
	heading: string;
	annotation: string | null;
}

export interface CommunityLinkInput {
	label: string;
	href: string;
	description?: string | null;
	tag?: string | null;
}

export interface ValidatedLinkInput {
	label: string;
	href: string;
	description: string | null;
	tag: string | null;
}

/**
 * Normalise and validate a group. Pure — throws CommunityLinkError (422) on
 * the first problem so the admin form can surface it verbatim.
 */
export function validateGroupInput(input: CommunityGroupInput): ValidatedGroupInput {
	const heading = input.heading.trim();
	if (heading.length < COMMUNITY_LINK_LIMITS.headingMin) {
		throw new CommunityLinkError(
			`Heading must be at least ${COMMUNITY_LINK_LIMITS.headingMin} characters.`,
			422
		);
	}
	if (heading.length > COMMUNITY_LINK_LIMITS.headingMax) {
		throw new CommunityLinkError(
			`Heading must be ${COMMUNITY_LINK_LIMITS.headingMax} characters or fewer.`,
			422
		);
	}

	const annotation = input.annotation?.trim() || null;
	if (annotation && annotation.length > COMMUNITY_LINK_LIMITS.annotationMax) {
		throw new CommunityLinkError(
			`Annotation must be ${COMMUNITY_LINK_LIMITS.annotationMax} characters or fewer.`,
			422
		);
	}

	return { heading, annotation };
}

/** Same contract as validateGroupInput, for a single link. */
export function validateLinkInput(input: CommunityLinkInput): ValidatedLinkInput {
	const label = input.label.trim();
	if (label.length < COMMUNITY_LINK_LIMITS.labelMin) {
		throw new CommunityLinkError(
			`Label must be at least ${COMMUNITY_LINK_LIMITS.labelMin} characters.`,
			422
		);
	}
	if (label.length > COMMUNITY_LINK_LIMITS.labelMax) {
		throw new CommunityLinkError(
			`Label must be ${COMMUNITY_LINK_LIMITS.labelMax} characters or fewer.`,
			422
		);
	}

	const rawHref = input.href.trim();
	if (!rawHref) throw new CommunityLinkError('Link URL is required.', 422);
	if (rawHref.length > COMMUNITY_LINK_LIMITS.hrefMax) {
		throw new CommunityLinkError('Link URL is too long.', 422);
	}
	let parsed: URL;
	try {
		parsed = new URL(rawHref);
	} catch {
		throw new CommunityLinkError('Link must be a valid URL.', 422);
	}
	// https only — these render as outbound links on a public page, so no
	// javascript:, data:, or plain-http destinations.
	if (parsed.protocol !== 'https:') {
		throw new CommunityLinkError('Link must use https.', 422);
	}

	const description = input.description?.trim() || null;
	if (description && description.length > COMMUNITY_LINK_LIMITS.descriptionMax) {
		throw new CommunityLinkError(
			`Description must be ${COMMUNITY_LINK_LIMITS.descriptionMax} characters or fewer.`,
			422
		);
	}

	const tag = input.tag?.trim() || null;
	if (tag && tag.length > COMMUNITY_LINK_LIMITS.tagMax) {
		throw new CommunityLinkError(
			`Tag must be ${COMMUNITY_LINK_LIMITS.tagMax} characters or fewer.`,
			422
		);
	}

	return { label, href: parsed.toString(), description, tag };
}

/**
 * Every group with its links, in display order. Empty when Supabase isn't
 * configured — callers that render the public page fall back to the static
 * module instead.
 */
export async function listCommunityLinkGroups(): Promise<CommunityLinkGroupRecord[]> {
	const admin = getSupabaseAdminClient();
	if (!admin) return [];

	const [groupsResult, linksResult] = await Promise.all([
		admin
			.from('community_link_groups')
			.select(GROUP_COLUMNS)
			.order('position', { ascending: true })
			.order('created_at', { ascending: true }),
		admin
			.from('community_links')
			.select(LINK_COLUMNS)
			.order('position', { ascending: true })
			.order('created_at', { ascending: true })
	]);

	if (groupsResult.error || linksResult.error) {
		console.error(
			'[community-links] listCommunityLinkGroups failed',
			groupsResult.error ?? linksResult.error
		);
		return [];
	}

	const byGroup = new Map<string, CommunityLinkRecord[]>();
	for (const link of (linksResult.data as CommunityLinkRecord[] | null) ?? []) {
		const existing = byGroup.get(link.group_id);
		if (existing) existing.push(link);
		else byGroup.set(link.group_id, [link]);
	}

	return ((groupsResult.data as Omit<CommunityLinkGroupRecord, 'links'>[] | null) ?? []).map(
		(group) => ({ ...group, links: byGroup.get(group.id) ?? [] })
	);
}

/**
 * The public /community shape. Falls back to the hardcoded groups in
 * src/lib/content/community.ts when Supabase isn't configured (local dev,
 * preview builds) so the page never renders empty.
 */
export async function listPublicCommunityGroups(): Promise<CommunityGroup[]> {
	const admin = getSupabaseAdminClient();
	if (!admin) return fallbackGroups;

	const groups = await listCommunityLinkGroups();
	return groups.map((group) => ({
		heading: group.heading,
		annotation: group.annotation ?? undefined,
		links: group.links.map((link) => ({
			label: link.label,
			href: link.href,
			description: link.description ?? undefined,
			tag: link.tag ?? undefined
		}))
	}));
}

async function nextPosition(table: 'community_link_groups' | 'community_links', groupId?: string) {
	const admin = requireAdminClient();
	let query = admin.from(table).select('position').order('position', { ascending: false }).limit(1);
	if (groupId) query = query.eq('group_id', groupId);
	const { data, error } = await query.maybeSingle<{ position: number }>();
	if (error) {
		console.error('[community-links] nextPosition failed', error);
		throw new CommunityLinkError('Could not work out the display order.', 500);
	}
	return (data?.position ?? -1) + 1;
}

export async function createGroup(
	input: CommunityGroupInput,
	actor: { role: ProfileRole }
): Promise<CommunityLinkGroupRecord> {
	assertCanCurate(actor);
	const admin = requireAdminClient();
	const validated = validateGroupInput(input);

	const { data, error } = await admin
		.from('community_link_groups')
		.insert({
			heading: validated.heading,
			annotation: validated.annotation,
			position: await nextPosition('community_link_groups')
		})
		.select(GROUP_COLUMNS)
		.single<Omit<CommunityLinkGroupRecord, 'links'>>();

	if (error || !data) {
		console.error('[community-links] createGroup failed', error);
		throw new CommunityLinkError('Could not create the group.', 500);
	}
	return { ...data, links: [] };
}

export async function updateGroup(
	groupId: string,
	input: CommunityGroupInput,
	actor: { role: ProfileRole }
): Promise<CommunityLinkGroupRecord> {
	assertCanCurate(actor);
	const admin = requireAdminClient();
	const validated = validateGroupInput(input);

	const { data, error } = await admin
		.from('community_link_groups')
		.update({ heading: validated.heading, annotation: validated.annotation })
		.eq('id', groupId)
		.select(GROUP_COLUMNS)
		.maybeSingle<Omit<CommunityLinkGroupRecord, 'links'>>();

	if (error) {
		console.error('[community-links] updateGroup failed', error);
		throw new CommunityLinkError('Could not update the group.', 500);
	}
	if (!data) throw new CommunityLinkError('Group not found.', 404);
	return { ...data, links: [] };
}

/** Deletes the group and, by cascade, every link inside it. */
export async function removeGroup(groupId: string, actor: { role: ProfileRole }): Promise<void> {
	assertCanCurate(actor);
	const admin = requireAdminClient();

	const { data, error } = await admin
		.from('community_link_groups')
		.delete()
		.eq('id', groupId)
		.select('id')
		.maybeSingle<{ id: string }>();

	if (error) {
		console.error('[community-links] removeGroup failed', error);
		throw new CommunityLinkError('Could not delete the group.', 500);
	}
	if (!data) throw new CommunityLinkError('Group not found.', 404);
}

export async function createLink(
	groupId: string,
	input: CommunityLinkInput,
	actor: { role: ProfileRole }
): Promise<CommunityLinkRecord> {
	assertCanCurate(actor);
	const admin = requireAdminClient();
	const validated = validateLinkInput(input);

	const { data: group, error: groupError } = await admin
		.from('community_link_groups')
		.select('id')
		.eq('id', groupId)
		.maybeSingle<{ id: string }>();
	if (groupError) {
		console.error('[community-links] createLink group lookup failed', groupError);
		throw new CommunityLinkError('Could not look up the group.', 500);
	}
	if (!group) throw new CommunityLinkError('Group not found.', 404);

	const { data, error } = await admin
		.from('community_links')
		.insert({
			group_id: groupId,
			label: validated.label,
			href: validated.href,
			description: validated.description,
			tag: validated.tag,
			position: await nextPosition('community_links', groupId)
		})
		.select(LINK_COLUMNS)
		.single<CommunityLinkRecord>();

	if (error || !data) {
		console.error('[community-links] createLink failed', error);
		throw new CommunityLinkError('Could not create the link.', 500);
	}
	return data;
}

export async function updateLink(
	linkId: string,
	input: CommunityLinkInput,
	actor: { role: ProfileRole }
): Promise<CommunityLinkRecord> {
	assertCanCurate(actor);
	const admin = requireAdminClient();
	const validated = validateLinkInput(input);

	const { data, error } = await admin
		.from('community_links')
		.update({
			label: validated.label,
			href: validated.href,
			description: validated.description,
			tag: validated.tag
		})
		.eq('id', linkId)
		.select(LINK_COLUMNS)
		.maybeSingle<CommunityLinkRecord>();

	if (error) {
		console.error('[community-links] updateLink failed', error);
		throw new CommunityLinkError('Could not update the link.', 500);
	}
	if (!data) throw new CommunityLinkError('Link not found.', 404);
	return data;
}

export async function removeLink(linkId: string, actor: { role: ProfileRole }): Promise<void> {
	assertCanCurate(actor);
	const admin = requireAdminClient();

	const { data, error } = await admin
		.from('community_links')
		.delete()
		.eq('id', linkId)
		.select('id')
		.maybeSingle<{ id: string }>();

	if (error) {
		console.error('[community-links] removeLink failed', error);
		throw new CommunityLinkError('Could not delete the link.', 500);
	}
	if (!data) throw new CommunityLinkError('Link not found.', 404);
}

export type MoveDirection = 'up' | 'down';

/**
 * Given rows already in display order, return them with the row at `index`
 * swapped with its neighbour. Pure so the reorder logic is testable without
 * a database.
 */
export function reorderSiblings<T>(rows: T[], index: number, direction: MoveDirection): T[] {
	const target = direction === 'up' ? index - 1 : index + 1;
	if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) return rows;
	const next = [...rows];
	[next[index], next[target]] = [next[target]!, next[index]!];
	return next;
}

/**
 * Renumber a sibling list to 0..n-1. Seeded and concurrently created rows can
 * share a `position`, so a plain neighbour swap isn't always enough — writing
 * the whole list keeps the order total. Lists are small (a handful of groups,
 * a few dozen links) so the write count stays trivial.
 */
async function persistOrder(
	table: 'community_link_groups' | 'community_links',
	ordered: { id: string; position: number }[]
): Promise<void> {
	const admin = requireAdminClient();
	const changed = ordered
		.map((row, index) => ({ id: row.id, position: index }))
		.filter((row, index) => ordered[index]!.position !== row.position);
	if (changed.length === 0) return;

	const results = await Promise.all(
		changed.map((row) => admin.from(table).update({ position: row.position }).eq('id', row.id))
	);
	const failed = results.find((result) => result.error);
	if (failed?.error) {
		console.error('[community-links] persistOrder failed', failed.error);
		throw new CommunityLinkError('Could not save the new order.', 500);
	}
}

export async function moveGroup(
	groupId: string,
	direction: MoveDirection,
	actor: { role: ProfileRole }
): Promise<void> {
	assertCanCurate(actor);
	const admin = requireAdminClient();

	const { data, error } = await admin
		.from('community_link_groups')
		.select('id, position')
		.order('position', { ascending: true })
		.order('created_at', { ascending: true });
	if (error) {
		console.error('[community-links] moveGroup list failed', error);
		throw new CommunityLinkError('Could not look up the groups.', 500);
	}

	const rows = (data as { id: string; position: number }[] | null) ?? [];
	const index = rows.findIndex((row) => row.id === groupId);
	if (index === -1) throw new CommunityLinkError('Group not found.', 404);

	await persistOrder('community_link_groups', reorderSiblings(rows, index, direction));
}

export async function moveLink(
	linkId: string,
	direction: MoveDirection,
	actor: { role: ProfileRole }
): Promise<void> {
	assertCanCurate(actor);
	const admin = requireAdminClient();

	const { data: link, error: linkError } = await admin
		.from('community_links')
		.select('id, group_id')
		.eq('id', linkId)
		.maybeSingle<{ id: string; group_id: string }>();
	if (linkError) {
		console.error('[community-links] moveLink lookup failed', linkError);
		throw new CommunityLinkError('Could not look up the link.', 500);
	}
	if (!link) throw new CommunityLinkError('Link not found.', 404);

	const { data, error } = await admin
		.from('community_links')
		.select('id, position')
		.eq('group_id', link.group_id)
		.order('position', { ascending: true })
		.order('created_at', { ascending: true });
	if (error) {
		console.error('[community-links] moveLink list failed', error);
		throw new CommunityLinkError('Could not look up the group links.', 500);
	}

	const rows = (data as { id: string; position: number }[] | null) ?? [];
	const index = rows.findIndex((row) => row.id === linkId);
	if (index === -1) throw new CommunityLinkError('Link not found.', 404);

	await persistOrder('community_links', reorderSiblings(rows, index, direction));
}
