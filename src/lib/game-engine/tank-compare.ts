import { statDefinitionByKey } from './stat-definitions';

export type CompareBetter = 'higher' | 'lower' | 'none';

export type CompareRowDef = {
	/** Raw vehicle stat key (matches `VehicleRecord.stats`). */
	key: string;
	label: string;
	unit?: string;
	/** Which direction wins the per-row highlight; 'none' rows never highlight. */
	better: CompareBetter;
	/** Multiply the raw stat before display (e.g. kg → t). */
	scale?: number;
	/** Tooltip shown on the row label for stats whose direction isn't obvious. */
	hint?: string;
};

export type CompareSectionDef = {
	id: string;
	title: string;
	rows: CompareRowDef[];
};

function row(key: string, overrides: Partial<Omit<CompareRowDef, 'key'>> = {}): CompareRowDef {
	const definition = statDefinitionByKey.get(key);
	return {
		key,
		label: overrides.label ?? definition?.label ?? key,
		unit: 'unit' in overrides ? overrides.unit : definition?.unit,
		better: overrides.better ?? (definition?.lowerBetter ? 'lower' : 'higher'),
		scale: overrides.scale,
		hint: overrides.hint
	};
}

/** Playstyle ratings (0–10) rendered as meters above the numeric table. */
export const RATING_MAX = 10;

export const compareRatingRows: CompareRowDef[] = [
	row('FirepowerRating', { label: 'Firepower', better: 'higher' }),
	row('DurabilityRating', { label: 'Durability', better: 'higher' }),
	row('ScoutingRating', { label: 'Scouting', better: 'higher' }),
	row('AbilityRating', { label: 'Ability', better: 'higher' })
];

export const compareSections: CompareSectionDef[] = [
	{
		id: 'firepower',
		title: 'Firepower',
		rows: [
			row('ShellDamage'),
			row('ShellPenetration', { unit: 'mm' }),
			row('ReloadTime'),
			row('ClipSize', { label: 'Clip Size' }),
			row('ShellVelocity'),
			row('GunMaxDepression', {
				label: 'Gun Depression',
				unit: 'deg',
				hint: 'More negative lets the gun aim further down over ridgelines.'
			})
		]
	},
	{
		id: 'survivability',
		title: 'Survivability',
		rows: [
			row('MaxHealth'),
			// Heavier soaks rams but turns slower, so mass is informational only.
			row('Mass', { label: 'Mass', unit: 't', scale: 0.001, better: 'none' })
		]
	},
	{
		id: 'mobility',
		title: 'Mobility',
		rows: [
			row('MaxSpeed'),
			row('MaxReverseSpeed'),
			row('MaxStrafingSpeed'),
			row('AccelerationTime'),
			row('HullTraverseSpeed'),
			row('TurretTraverseSpeed')
		]
	},
	{
		id: 'recon',
		title: 'Recon & Stealth',
		rows: [
			row('VisionRadius'),
			// Raw data confirms this is the tank's own signature radius (stealthy
			// lights sit near 35 m, heavies near 100 m; the Silenced shell zeroes it
			// to fire "without increasing visibility"), so smaller keeps you hidden.
			row('DetectionRadius', {
				better: 'lower',
				hint: 'Radius at which enemies detect this vehicle — smaller keeps you hidden longer.'
			}),
			row('CamoPercentage')
		]
	}
];

/** Every raw stat key the compare page reads; the server load trims payload to these. */
export const compareStatKeys: readonly string[] = [
	'DifficultyRating',
	...compareRatingRows.map((entry) => entry.key),
	...compareSections.flatMap((section) => section.rows.map((entry) => entry.key))
];

export function scaleCompareValue(rowDef: CompareRowDef, raw: number | undefined): number {
	const value = Number(raw ?? 0);
	return rowDef.scale != null ? value * rowDef.scale : value;
}

export function formatCompareValue(value: number): string {
	if (!Number.isFinite(value)) return '—';
	if (Number.isInteger(value)) return String(value);
	return value.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * The value that should be highlighted for a row, or null when nothing should
 * be (neutral rows, fewer than two comparable values, or a tie across the board).
 */
export function bestCompareValue(
	values: Array<number | null | undefined>,
	better: CompareBetter
): number | null {
	if (better === 'none') return null;
	const finite = values.filter(
		(value): value is number => typeof value === 'number' && Number.isFinite(value)
	);
	if (finite.length < 2) return null;
	const best = better === 'lower' ? Math.min(...finite) : Math.max(...finite);
	const worst = better === 'lower' ? Math.max(...finite) : Math.min(...finite);
	if (best === worst) return null;
	return best;
}

/** Rows where every selected tank reads 0 carry no signal (e.g. strafe on tracked hulls). */
export function shouldShowCompareRow(values: Array<number | null | undefined>): boolean {
	return values.some((value) => typeof value === 'number' && value !== 0);
}
