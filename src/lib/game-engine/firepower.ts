/**
 * Theoretical sustained firepower derived from a vehicle's weapon stats.
 *
 * Clip semantics (confirmed against in-game behaviour): `ReloadTime` is the full
 * reload after the clip is emptied and `IntraClipReloadTime` is the gap between
 * shots inside a clip. Single-shot guns never use the intra-clip value, even
 * though most of them export a placeholder for it.
 *
 * Every shot is assumed to hit and penetrate; event-driven effects (active-reload
 * reductions, on-hit damage stacks, …) only show up through the stats passed in.
 */
export type Firepower = {
	/** Damage per minute over repeated full clip + reload cycles. */
	dpm: number;
	/** Damage from emptying one full clip (equals shell damage for single-shot guns). */
	burstDamage: number;
	/** Seconds from the first shot of a clip to the first shot of the next. */
	cycleTime: number;
	clipSize: number;
	shellDamage: number;
	reloadTime: number;
	/** Gap between shots inside a clip; always 0 for single-shot guns. */
	intraClipReloadTime: number;
};

export type FirepowerKey = 'dpm' | 'burstDamage' | 'cycleTime';

export type FirepowerDefinition = {
	key: FirepowerKey;
	label: string;
	unit?: string;
	lowerBetter?: boolean;
	hint: string;
};

export const firepowerDefinitions: FirepowerDefinition[] = [
	{
		key: 'dpm',
		label: 'DPM',
		hint: 'Theoretical damage per minute: every shot hits and penetrates, full clip then full reload.'
	},
	{
		key: 'burstDamage',
		label: 'Burst Damage',
		hint: 'Damage from emptying one full clip.'
	},
	{
		key: 'cycleTime',
		label: 'Cycle Time',
		unit: 's',
		lowerBetter: true,
		hint: 'Reload time plus the intra-clip gaps between shots in one clip.'
	}
];

export function calculateFirepower(stats: Record<string, number | undefined>): Firepower | null {
	const damage = Number(stats.ShellDamage ?? 0);
	const reload = Number(stats.ReloadTime ?? 0);
	const rawClip = Number(stats.ClipSize ?? 1);
	const clipSize = Number.isFinite(rawClip) ? Math.max(1, Math.round(rawClip)) : 1;
	const intra = clipSize > 1 ? Number(stats.IntraClipReloadTime ?? 0) : 0;

	if (![damage, reload, intra].every(Number.isFinite) || damage < 0) return null;

	const reloadTime = Math.max(0, reload);
	const intraClipReloadTime = Math.max(0, intra);
	const cycleTime = reloadTime + (clipSize - 1) * intraClipReloadTime;
	if (cycleTime <= 0) return null;

	const burstDamage = damage * clipSize;
	return {
		dpm: (burstDamage * 60) / cycleTime,
		burstDamage,
		cycleTime,
		clipSize,
		shellDamage: damage,
		reloadTime,
		intraClipReloadTime
	};
}
