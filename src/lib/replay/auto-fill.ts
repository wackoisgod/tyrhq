import type { ReplayUploadPayload } from './upload-payload';

export interface RegisteredPlayer {
	userId: string;
	teamId: string;
	displayName: string;
	steamId: string | null;
}

export interface VehicleLookup {
	id: string;
	key: string;
	name: string;
}

export interface AutoFillPlayerStats {
	kills: number | null;
	damage: number | null;
	blocked: number | null;
	assist: number | null;
	tankCodename: string | null;
	partyId: string | null;
}

export interface AutoFillPlayer {
	name: string;
	steamId: string | null;
	replayTeam: 0 | 1;
	/** Registered team when matched, otherwise the side this replay team lined up with. */
	teamId: string | null;
	matchedUserId: string | null;
	matchMethod: 'steam_id' | 'display_name' | 'unmatched';
	teamMismatch: boolean;
	/** 1-based scoreboard rank. Winners come first when the replay has a winner. */
	placement: number | null;
	vehicleId: string | null;
	vehicleName: string | null;
	stats: AutoFillPlayerStats;
}

export interface TeamPlacement {
	teamId: string;
	replayTeam: 0 | 1;
	placement: 1 | 2 | null;
}

export interface ReplayAutoFill {
	replayGuid: string;
	changelist: number | null;
	suggestedWinnerTeamId: string | null;
	teamsSwapped: boolean;
	teamPlacements: TeamPlacement[];
	players: AutoFillPlayer[];
	warnings: string[];
}

export interface ReplayStatRow {
	userId: string;
	teamId: string;
	placement: number | null;
	kills: number | null;
	damage: number | null;
	blocked: number | null;
	assist: number | null;
	tankCodename: string | null;
	partyId: string | null;
}

interface ReplayPerson {
	name: string;
	replayTeam: 0 | 1;
	steamId: string | null;
	kills: number | null;
	damage: number | null;
	blocked: number | null;
	assist: number | null;
	tank: string | null;
	partyId: string | null;
}

function cleanName(value: string) {
	return value.trim();
}

function peopleFromPayload(payload: ReplayUploadPayload): ReplayPerson[] {
	const statsByName = new Map<string, ReplayUploadPayload['endgameStats'][number]>();
	for (const row of payload.endgameStats) {
		if (!statsByName.has(row.name)) statsByName.set(row.name, row);
	}
	const seen = new Set<string>();
	const people: ReplayPerson[] = [];
	for (const player of payload.roster) {
		const name = cleanName(player.name);
		if (!name || seen.has(name)) continue;
		seen.add(name);
		const stats = statsByName.get(player.name) ?? statsByName.get(name);
		people.push({
			name,
			replayTeam: player.teamId,
			steamId: player.steamId,
			kills: stats?.kills ?? null,
			damage: stats?.damage ?? null,
			blocked: stats?.blocked ?? null,
			assist: stats?.assist ?? null,
			tank: stats?.tank ?? null,
			partyId: stats?.partyId ?? null
		});
	}
	for (const row of payload.endgameStats) {
		const name = cleanName(row.name);
		if (!name || seen.has(name)) continue;
		seen.add(name);
		people.push({
			name,
			replayTeam: row.team,
			steamId: null,
			kills: row.kills,
			damage: row.damage,
			blocked: row.blocked,
			assist: row.assist,
			tank: row.tank,
			partyId: row.partyId
		});
	}
	return people;
}

function alignTeams(
	people: ReplayPerson[],
	players: RegisteredPlayer[],
	teamAId: string,
	teamBId: string
) {
	const bySteam = new Map<string, RegisteredPlayer>();
	for (const player of players) {
		if (player.steamId && !bySteam.has(player.steamId)) bySteam.set(player.steamId, player);
	}
	let direct = 0;
	let swapped = 0;
	for (const person of people) {
		if (!person.steamId) continue;
		const registered = bySteam.get(person.steamId);
		if (!registered) continue;
		const onA = registered.teamId === teamAId;
		const onB = registered.teamId === teamBId;
		if (!onA && !onB) continue;
		if (person.replayTeam === 0) {
			if (onA) direct += 1;
			else swapped += 1;
		} else if (onA) swapped += 1;
		else direct += 1;
	}
	const teamsSwapped = swapped > direct;
	return {
		teamsSwapped,
		byReplay: {
			0: teamsSwapped ? teamBId : teamAId,
			1: teamsSwapped ? teamAId : teamBId
		} as const
	};
}

function vehicleFor(codename: string | null, vehicles: VehicleLookup[]) {
	if (!codename) return { vehicleId: null, vehicleName: null };
	const vehicle = vehicles.find((item) => item.key === `Gameplay.Vehicle.${codename}`);
	return {
		vehicleId: vehicle?.id ?? null,
		vehicleName: vehicle?.name ?? codename
	};
}

/**
 * Map a parsed scoreboard onto the two registered teams.
 * Steam IDs decide which replay side is which team, then which player is which account.
 * Display names are a fallback and only match when exactly one unchecked player has that name.
 */
export function buildReplayAutoFill(input: {
	payload: ReplayUploadPayload & { replayGuid: string };
	teamAId: string;
	teamBId: string;
	players: RegisteredPlayer[];
	vehicles?: VehicleLookup[];
}): ReplayAutoFill {
	const vehicles = input.vehicles ?? [];
	const people = peopleFromPayload(input.payload);
	const { teamsSwapped, byReplay } = alignTeams(people, input.players, input.teamAId, input.teamBId);
	const winnerReplayTeam = input.payload.winnerTeam;

	const bySteam = new Map<string, RegisteredPlayer>();
	for (const player of input.players) {
		if (player.steamId && !bySteam.has(player.steamId)) bySteam.set(player.steamId, player);
	}
	const byName = new Map<string, RegisteredPlayer[]>();
	for (const player of input.players) {
		const name = cleanName(player.displayName);
		if (!name) continue;
		const bucket = byName.get(name) ?? [];
		bucket.push(player);
		byName.set(name, bucket);
	}

	const claimed = new Set<string>();
	const draft: Array<{
		person: ReplayPerson;
		matched: RegisteredPlayer | null;
		matchMethod: AutoFillPlayer['matchMethod'];
	}> = people.map((person) => {
		const steam = person.steamId ? bySteam.get(person.steamId) : undefined;
		if (steam && !claimed.has(steam.userId) && (steam.teamId === input.teamAId || steam.teamId === input.teamBId)) {
			claimed.add(steam.userId);
			return { person, matched: steam, matchMethod: 'steam_id' as const };
		}
		return { person, matched: null as RegisteredPlayer | null, matchMethod: 'unmatched' as const };
	});

	for (const row of draft) {
		if (row.matched) continue;
		const available = (byName.get(row.person.name) ?? []).filter(
			(player) =>
				!claimed.has(player.userId) && (player.teamId === input.teamAId || player.teamId === input.teamBId)
		);
		if (available.length !== 1) continue;
		claimed.add(available[0].userId);
		row.matched = available[0];
		row.matchMethod = 'display_name';
	}

	draft.sort((a, b) => {
		if (winnerReplayTeam === 0 || winnerReplayTeam === 1) {
			const aWin = a.person.replayTeam === winnerReplayTeam ? 0 : 1;
			const bWin = b.person.replayTeam === winnerReplayTeam ? 0 : 1;
			if (aWin !== bWin) return aWin - bWin;
		}
		const kills = (b.person.kills ?? -1) - (a.person.kills ?? -1);
		if (kills !== 0) return kills;
		const damage = (b.person.damage ?? -1) - (a.person.damage ?? -1);
		if (damage !== 0) return damage;
		return a.person.name.localeCompare(b.person.name);
	});

	const players: AutoFillPlayer[] = draft.map((row, index) => {
		const alignedTeamId = byReplay[row.person.replayTeam];
		const vehicle = vehicleFor(row.person.tank, vehicles);
		return {
			name: row.person.name,
			steamId: row.person.steamId,
			replayTeam: row.person.replayTeam,
			teamId: row.matched?.teamId ?? alignedTeamId,
			matchedUserId: row.matched?.userId ?? null,
			matchMethod: row.matchMethod,
			teamMismatch: Boolean(row.matched && row.matched.teamId !== alignedTeamId),
			placement: index + 1,
			vehicleId: vehicle.vehicleId,
			vehicleName: vehicle.vehicleName,
			stats: {
				kills: row.person.kills,
				damage: row.person.damage,
				blocked: row.person.blocked,
				assist: row.person.assist,
				tankCodename: row.person.tank,
				partyId: row.person.partyId
			}
		};
	});

	const warnings = [...input.payload.warnings];
	if (teamsSwapped) warnings.push('Replay sides were lined up using Steam IDs.');

	return {
		replayGuid: input.payload.replayGuid,
		changelist: input.payload.changelist,
		suggestedWinnerTeamId: winnerReplayTeam === null ? null : byReplay[winnerReplayTeam],
		teamsSwapped,
		teamPlacements: ([0, 1] as const).map((replayTeam) => ({
			teamId: byReplay[replayTeam],
			replayTeam,
			placement: winnerReplayTeam === null ? null : winnerReplayTeam === replayTeam ? 1 : 2
		})),
		players,
		warnings
	};
}

/** Rows the organizer checked. Unknown ids and unmatched scoreboard lines are dropped. */
export function replayStatRows(autoFill: ReplayAutoFill, acceptedUserIds: readonly string[]): ReplayStatRow[] {
	const accepted = new Set(acceptedUserIds);
	const seen = new Set<string>();
	const rows: ReplayStatRow[] = [];
	for (const player of autoFill.players) {
		if (!player.matchedUserId || !player.teamId || player.matchMethod === 'unmatched') continue;
		if (!accepted.has(player.matchedUserId) || seen.has(player.matchedUserId)) continue;
		seen.add(player.matchedUserId);
		rows.push({
			userId: player.matchedUserId,
			teamId: player.teamId,
			placement: player.placement,
			kills: player.stats.kills,
			damage: player.stats.damage,
			blocked: player.stats.blocked,
			assist: player.stats.assist,
			tankCodename: player.stats.tankCodename,
			partyId: player.stats.partyId
		});
	}
	return rows;
}
