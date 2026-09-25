/**
 * Some shells replace a stat with a fixed value instead of scaling it — HE's "fixed 45mm
 * penetration", Momentum's "Travels at a fixed 500 m/s". The exported ammo modifiers leave
 * those stats at ×1, so the only source for the fixed figure is the in-game description.
 */
export type AmmoFixedStats = {
	/** Stat key (e.g. `ShellPenetration`) → the value the shell always uses. */
	ShellPenetration?: number;
	ShellVelocity?: number;
};

const fixedStatPatterns: Array<{ key: keyof AmmoFixedStats; pattern: RegExp }> = [
	{ key: 'ShellPenetration', pattern: /\bfixed (?:at )?(\d+(?:\.\d+)?)\s*mm(?: of)? penetration\b/i },
	{ key: 'ShellVelocity', pattern: /\bfixed (?:at )?(\d+(?:\.\d+)?)\s*m\/s\b/i }
];

export function getAmmoFixedStats(ammo: { description?: string } | null | undefined): AmmoFixedStats {
	const description = ammo?.description ?? '';
	const fixed: AmmoFixedStats = {};
	for (const { key, pattern } of fixedStatPatterns) {
		const value = Number(description.match(pattern)?.[1]);
		if (Number.isFinite(value) && value > 0) fixed[key] = value;
	}
	return fixed;
}
