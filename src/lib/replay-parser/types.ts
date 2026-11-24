/**
 * Replay parser types.
 *
 * Ported from tyr-replay-tools (MIT License).
 * See LICENSE.md for full attribution.
 */

export interface PlayerEndGameStats {
	name: string;
	team: number;
	kills: number | null;
	damage: number | null;
	blocked: number | null;
	assist: number | null;
	tankIdx: number | null;
	tank: string | null; // Codename like "Bush" or "Healer"
	partyId: string | null;
}

export interface PlayerRosterEntry {
	name: string;
	teamId: number;
	steamId: string | null; // SteamID64 as decimal string
	clan: string | null;
	channels: number[];
}

export interface ReplayParseResult {
	/** Player roster with SteamID64 */
	roster: PlayerRosterEntry[];
	/** End-game stats (scoreboard) */
	endgameStats: PlayerEndGameStats[];
	/** Winning team (0 or 1). Health-pool result, else the other side of the last stand. */
	winnerTeam: number | null;
	/** Replay GUID (16-byte hex string from header) */
	replayGuid: string | null;
	/** Game changelist/version */
	changelist: number | null;
	/** Header level path, such as /TyrMapRavine/Maps/Map_Ravine. */
	levelName: string | null;
	/** Warnings encountered during parse */
	warnings: string[];
}

/**
 * Tank index to codename mapping from the Python reference.
 * Maps the tankIdx field in endgame stats to internal codenames.
 */
export const TANK_CODENAMES: Record<number, string> = {
	5: 'Blink', // display: Alecto
	7: 'Bush', // display: Ark
	8: 'CanOpener', // display: Arbalest
	10: 'Drone', // display: Kestrel
	11: 'Healer', // display: Valor
	12: 'Ram', // display: Maul
	13: 'Ranger',
	14: 'Tempest',
	15: 'SentinelTank', // display: Tricera
	16: 'Helio',
	17: 'Sonar', // display: Atlas
	19: 'Stealth', // display: Phantom
	20: 'Vanguard',
	21: 'Vtol', // display: Ikarus
	22: 'Rook',
	6: 'Brawler', // display: Fortis
	9: 'Deadeye'
};

/**
 * Map replay codenames to GameData vehicle keys.
 * Bush -> Gameplay.Vehicle.Bush, etc.
 */
export function codenameToVehicleKey(codename: string): string | null {
	// Most codenames map directly to GameData keys
	const key = `Gameplay.Vehicle.${codename}`;
	return key;
}
