import type { PlayerEndGameStats, PlayerRosterEntry, ReplayParseResult } from '$lib/replay-parser/types';

const GUID_PATTERN = /^[0-9a-f]{32}$/i;
const STEAM_ID_PATTERN = /^\d{15,20}$/;

export interface ReplayRosterPlayer {
	name: string;
	teamId: 0 | 1;
	steamId: string | null;
	clan: string | null;
}

export interface ReplayScoreboardRow {
	name: string;
	team: 0 | 1;
	kills: number | null;
	damage: number | null;
	blocked: number | null;
	assist: number | null;
	tankIdx: number | null;
	tank: string | null;
	partyId: string | null;
}

/**
 * Parsed replay fields the browser is allowed to send.
 * The .replay bytes never leave the client.
 */
export interface ReplayUploadPayload {
	replayGuid: string | null;
	changelist: number | null;
	winnerTeam: 0 | 1 | null;
	roster: ReplayRosterPlayer[];
	endgameStats: ReplayScoreboardRow[];
	warnings: string[];
}

export interface ReplayPreview {
	payload: ReplayUploadPayload & { replayGuid: string };
	alreadyOnThisMatch: boolean;
}

function asTeam(value: number): 0 | 1 | null {
	return value === 0 || value === 1 ? value : null;
}

function asSteamId(value: string | null): string | null {
	if (!value || !STEAM_ID_PATTERN.test(value)) return null;
	return value;
}

function asClan(value: string | null): string | null {
	if (!value) return null;
	const trimmed = value.trim().slice(0, 64);
	return trimmed || null;
}

function asStat(value: number | null): number | null {
	if (value === null || !Number.isInteger(value) || value < 0 || value > 2_000_000_000) return null;
	return value;
}

function asName(value: string): string {
	return value.trim().slice(0, 128);
}

function toRosterPlayer(entry: PlayerRosterEntry): ReplayRosterPlayer | null {
	const teamId = asTeam(entry.teamId);
	const name = asName(entry.name);
	if (teamId === null || !name) return null;
	return {
		name,
		teamId,
		steamId: asSteamId(entry.steamId),
		clan: asClan(entry.clan)
	};
}

function toScoreboardRow(entry: PlayerEndGameStats): ReplayScoreboardRow | null {
	const team = asTeam(entry.team);
	const name = asName(entry.name);
	if (team === null || !name) return null;
	return {
		name,
		team,
		kills: asStat(entry.kills),
		damage: asStat(entry.damage),
		blocked: asStat(entry.blocked),
		assist: asStat(entry.assist),
		tankIdx:
			entry.tankIdx !== null && Number.isInteger(entry.tankIdx) && entry.tankIdx >= 0 && entry.tankIdx <= 63
				? entry.tankIdx
				: null,
		tank: entry.tank ? entry.tank.trim().slice(0, 64) || null : null,
		partyId: entry.partyId ? entry.partyId.trim().slice(0, 64) || null : null
	};
}

/**
 * Keep header, roster, scoreboard, and winner. Drop parser internals such as channel ids.
 */
export function toReplayUploadPayload(result: ReplayParseResult): ReplayUploadPayload {
	const warnings = result.warnings.slice(0, 40).map((warning) => warning.slice(0, 400));
	const roster = result.roster
		.slice(0, 32)
		.map(toRosterPlayer)
		.filter((entry): entry is ReplayRosterPlayer => entry !== null);
	const endgameStats = result.endgameStats
		.slice(0, 32)
		.map(toScoreboardRow)
		.filter((entry): entry is ReplayScoreboardRow => entry !== null);
	const changelist =
		result.changelist !== null &&
		Number.isInteger(result.changelist) &&
		result.changelist >= 0 &&
		result.changelist <= 10_000_000
			? result.changelist
			: null;
	return {
		replayGuid: result.replayGuid && GUID_PATTERN.test(result.replayGuid) ? result.replayGuid.toLowerCase() : null,
		changelist,
		winnerTeam: result.winnerTeam === 0 || result.winnerTeam === 1 ? result.winnerTeam : null,
		roster,
		endgameStats,
		warnings
	};
}
