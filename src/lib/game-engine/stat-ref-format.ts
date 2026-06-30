import { statDefinitionByKey } from './stat-definitions';

/**
 * Pure helpers for inline "game data references" inside articles. An author
 * writes a `:stat{tank="atlas" stat="health"}` text directive; the sanitizer
 * (src/lib/server/content-sanitize.ts) rewrites it to a reference-only
 * `<aggro-stat data-tank data-stat data-show>` element. The *value* is never
 * baked into the stored HTML — it is resolved against the live game-data bundle
 * every time the article renders (src/lib/server/game-data-refs.ts), so a stat
 * automatically tracks the latest game data without re-editing the article.
 *
 * This module is intentionally free of any game-data import so it can be unit
 * tested without the GameData submodule checked out: the bundle-backed lookups
 * live in the server module and are injected into `transformStatRefHtml`.
 */

/** How a resolved stat is rendered. */
export const SHOW_MODES = ['value', 'number', 'label'] as const;
export type ShowMode = (typeof SHOW_MODES)[number];

/** Author-friendly aliases mapped to the raw game-data stat keys. */
export const STAT_ALIASES: Record<string, string> = {
	health: 'MaxHealth',
	hp: 'MaxHealth',
	speed: 'MaxSpeed',
	'top-speed': 'MaxSpeed',
	topspeed: 'MaxSpeed',
	reverse: 'MaxReverseSpeed',
	'reverse-speed': 'MaxReverseSpeed',
	strafe: 'MaxStrafingSpeed',
	'strafe-speed': 'MaxStrafingSpeed',
	reload: 'ReloadTime',
	'reload-time': 'ReloadTime',
	'intra-reload': 'IntraClipReloadTime',
	'shell-swap': 'ShellSwapTime',
	damage: 'ShellDamage',
	dmg: 'ShellDamage',
	penetration: 'ShellPenetration',
	pen: 'ShellPenetration',
	velocity: 'ShellVelocity',
	'shell-velocity': 'ShellVelocity',
	aim: 'DispersionReductionSpeed',
	'aim-speed': 'DispersionReductionSpeed',
	vision: 'VisionRadius',
	detection: 'DetectionRadius',
	camo: 'CamoPercentage',
	'hull-traverse': 'HullTraverseSpeed',
	'turret-traverse': 'TurretTraverseSpeed',
	'gun-traverse': 'GunTraverseSpeed',
	acceleration: 'AccelerationTime',
	'max-energy': 'MaxAbilityResource',
	cooldown: 'AbilityCooldown',
	'ability-cooldown': 'AbilityCooldown',
	'ability-cost': 'AbilityCost'
};

/** Tank slugs are lowercase kebab tokens (matches game-data vehicle slugs). */
export const TANK_TOKEN_RE = /^[a-z0-9-]{1,40}$/;
/** A stat token is an alias, a special field (name/class), or a raw stat key. */
export const STAT_TOKEN_RE = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;

/** The minimal shape `transformStatRefHtml`'s resolver and the formatters need. */
export interface VehicleLike {
	name: string;
	classLabel?: string;
	classId?: string;
	stats: Record<string, number>;
}

export type NormalizedStat =
	| { kind: 'name' }
	| { kind: 'class' }
	| { kind: 'stat'; key: string }
	| null;

const RAW_KEY_BY_LOWER = new Map(
	[...statDefinitionByKey.keys()].map((key) => [key.toLowerCase(), key])
);

/** Resolve an author-supplied `show` value, defaulting to `value`. */
export function normalizeShow(raw: string | undefined | null): ShowMode {
	const t = (raw ?? '').trim().toLowerCase();
	return (SHOW_MODES as readonly string[]).includes(t) ? (t as ShowMode) : 'value';
}

/**
 * Map an author stat token to a canonical reference. Returns `null` when the
 * token isn't an alias, a known stat key, or one of the `name`/`class` fields.
 * Whether the value actually exists on a given vehicle is checked later.
 */
export function normalizeStatKey(raw: string): NormalizedStat {
	const t = raw.trim();
	const lower = t.toLowerCase();
	if (lower === 'name') return { kind: 'name' };
	if (lower === 'class') return { kind: 'class' };
	const alias = STAT_ALIASES[lower];
	if (alias) return { kind: 'stat', key: alias };
	const canonical = RAW_KEY_BY_LOWER.get(lower);
	if (canonical) return { kind: 'stat', key: canonical };
	return null;
}

/** Human-readable label for a raw stat key (uses the site stat definitions). */
export function statLabel(key: string): string {
	const def = statDefinitionByKey.get(key);
	if (def) return def.label;
	return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

/** Format a numeric stat value with thousands separators and minimal decimals. */
export function formatStatNumber(value: number): string {
	const rounded = Math.round(value * 100) / 100;
	const [intPart, frac] = String(rounded).split('.');
	const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	return frac ? `${grouped}.${frac}` : grouped;
}

/** Append the stat's unit (no space for `%`/`s`, a single space otherwise). */
export function withUnit(num: string, unit: string | undefined): string {
	if (!unit) return num;
	if (unit === '%' || unit === 's') return `${num}${unit}`;
	return `${num} ${unit}`;
}

export type StatResolution =
	| { ok: true; text: string; label: string }
	| { ok: false; reason: 'unknown-stat' | 'missing-value' };

/**
 * Resolve a stat reference against a single vehicle to display text. Pure: the
 * caller supplies the vehicle, so this is testable without the game-data bundle.
 */
export function resolveStatText(vehicle: VehicleLike, raw: string, show: ShowMode): StatResolution {
	const norm = normalizeStatKey(raw);
	if (!norm) return { ok: false, reason: 'unknown-stat' };

	if (norm.kind === 'name') return { ok: true, text: vehicle.name, label: 'Name' };
	if (norm.kind === 'class') {
		const text = vehicle.classLabel ?? vehicle.classId;
		if (!text) return { ok: false, reason: 'missing-value' };
		return { ok: true, text, label: 'Class' };
	}

	const value = vehicle.stats?.[norm.key];
	if (typeof value !== 'number' || Number.isNaN(value)) {
		return { ok: false, reason: 'missing-value' };
	}
	const label = statLabel(norm.key);
	if (show === 'label') return { ok: true, text: label, label };
	const num = formatStatNumber(value);
	if (show === 'number') return { ok: true, text: num, label };
	return { ok: true, text: withUnit(num, statDefinitionByKey.get(norm.key)?.unit), label };
}

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export interface StatRef {
	tank: string;
	stat: string;
	show: ShowMode;
}

const STAT_EL_RE = /<aggro-stat\b([^>]*)><\/aggro-stat>|<aggro-stat\b([^>]*)>[\s\S]*?<\/aggro-stat>/g;
const ATTR_RE = /([a-z-]+)="([^"]*)"/g;

function parseAttrs(attrString: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	let m: RegExpExecArray | null;
	ATTR_RE.lastIndex = 0;
	while ((m = ATTR_RE.exec(attrString)) !== null) {
		attrs[m[1]] = m[2];
	}
	return attrs;
}

function refFromAttrs(attrString: string): StatRef {
	const attrs = parseAttrs(attrString);
	return {
		tank: attrs['data-tank'] ?? '',
		stat: attrs['data-stat'] ?? '',
		show: normalizeShow(attrs['data-show'])
	};
}

/** Collect every `<aggro-stat>` reference in a rendered HTML body. */
export function findStatRefs(html: string): StatRef[] {
	const refs: StatRef[] = [];
	let m: RegExpExecArray | null;
	STAT_EL_RE.lastIndex = 0;
	while ((m = STAT_EL_RE.exec(html)) !== null) {
		refs.push(refFromAttrs(m[1] ?? m[2] ?? ''));
	}
	return refs;
}

/** What a `transformStatRefHtml` resolver returns for a single reference. */
export type StatRender = { text: string; title?: string } | null;

/**
 * Replace every reference-only `<aggro-stat>` element with one whose visible
 * text is the freshly resolved value. Idempotent: works whether the element is
 * empty (as the sanitizer emits it) or already filled (a previous render).
 * A reference the resolver can't satisfy falls back to an em dash.
 */
export function transformStatRefHtml(
	html: string,
	resolve: (ref: StatRef) => StatRender
): string {
	return html.replace(STAT_EL_RE, (_match, emptyAttrs, filledAttrs) => {
		const attrString = emptyAttrs ?? filledAttrs ?? '';
		const ref = refFromAttrs(attrString);
		const rendered = resolve(ref);
		const text = rendered?.text ?? '—';
		const titleAttr = rendered?.title ? ` title="${escapeHtml(rendered.title)}"` : '';
		return (
			`<aggro-stat data-tank="${escapeHtml(ref.tank)}" data-stat="${escapeHtml(ref.stat)}"` +
			` data-show="${ref.show}"${titleAttr}>${escapeHtml(text)}</aggro-stat>`
		);
	});
}
