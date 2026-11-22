/**
 * Server-side replay file parsing and auto-fill logic.
 */

import { parseReplay, type ReplayParseResult, type PlayerRosterEntry } from './replay-parser';
import { getSupabaseAdminClient } from './supabase-admin';
import { getGameDataBundle } from '$lib/data/game-data';

export interface ReplayAutoFillSuggestions {
	/** Suggested winner team ID */
	suggestedWinner: string | null;
	/** Player suggestions with matching */
	playerSuggestions: Array<{
		name: string;
		steamId: string | null;
		matchedUserId: string | null;
		matchMethod: 'steam_id' | 'display_name' | 'unmatched';
		team: number;
		stats: {
			kills: number | null;
			damage: number | null;
			blocked: number | null;
			assist: number | null;
			tankCodename: string | null;
			tankName: string | null;
		};
	}>;
	/** Replay GUID for dedupe */
	replayGuid: string | null;
	/** Changelist/version */
	changelist: number | null;
	/** Warnings from parse */
	warnings: string[];
}

/**
 * Map replay tank codename to GameData vehicle name.
 */
function mapTankCodename(codename: string | null): string | null {
	if (!codename) return null;

	const bundle = getGameDataBundle();
	const vehicleKey = `Gameplay.Vehicle.${codename}`;
	const vehicle = bundle.vehicles.find((v) => v.key === vehicleKey);
	return vehicle?.name ?? codename;
}

/**
 * Match roster players against tournament roster.
 * Priority:
 * 1. Verified SteamID64 (from profiles.verified_steam_id)
 * 2. Exact display name match
 * 3. Unmatched (organizer assigns manually)
 */
async function matchPlayers(
	replayResult: ReplayParseResult,
	tournamentId: string,
	teamAId: string,
	teamBId: string
): Promise<ReplayAutoFillSuggestions['playerSuggestions']> {
	const supabase = getSupabaseAdminClient();
	if (!supabase) {
		throw new Error('Failed to initialize database client');
	}

	// Get tournament roster with verified Steam IDs
	const { data: rosterMembers } = await supabase
		.from('tournament_roster_members')
		.select(
			`
			user_id,
			team_id,
			profiles!inner(
				display_name,
				verified_steam_id
			)
		`
		)
		.eq('tournament_id', tournamentId)
		.in('team_id', [teamAId, teamBId]);

	if (!rosterMembers) {
		return [];
	}

	const suggestions: ReplayAutoFillSuggestions['playerSuggestions'] = [];

	for (const rosterEntry of replayResult.roster) {
		const stats = replayResult.endgameStats.find((s) => s.name === rosterEntry.name);

		// Try Steam ID match first
		let matched = rosterMembers.find(
			(m) =>
				rosterEntry.steamId &&
				(m.profiles as unknown as { verified_steam_id: string | null }).verified_steam_id ===
					rosterEntry.steamId
		);

		let matchMethod: ReplayAutoFillSuggestions['playerSuggestions'][0]['matchMethod'] = 'unmatched';

		if (matched) {
			matchMethod = 'steam_id';
		} else {
			// Try display name match
			matched = rosterMembers.find(
				(m) =>
					(m.profiles as unknown as { display_name: string }).display_name === rosterEntry.name
			);
			if (matched) {
				matchMethod = 'display_name';
			}
		}

		suggestions.push({
			name: rosterEntry.name,
			steamId: rosterEntry.steamId,
			matchedUserId: matched?.user_id ?? null,
			matchMethod,
			team: rosterEntry.teamId,
			stats: {
				kills: stats?.kills ?? null,
				damage: stats?.damage ?? null,
				blocked: stats?.blocked ?? null,
				assist: stats?.assist ?? null,
				tankCodename: stats?.tank ?? null,
				tankName: mapTankCodename(stats?.tank ?? null)
			}
		});
	}

	return suggestions;
}

/**
 * Parse a replay file and generate auto-fill suggestions.
 * This does NOT save to the database - it only returns suggestions
 * for the organizer to review.
 */
export async function generateAutoFillSuggestions(
	replayBuffer: Uint8Array,
	tournamentId: string,
	matchId: string,
	teamAId: string,
	teamBId: string
): Promise<{ success: true; suggestions: ReplayAutoFillSuggestions } | { success: false; error: string }> {
	try {
		// Parse replay
		const result = parseReplay(replayBuffer);

		if (!result.replayGuid) {
			return { success: false, error: 'Invalid replay file - could not read header' };
		}

		// Check for duplicate GUID
		const supabase = getSupabaseAdminClient();
		if (!supabase) {
			return { success: false, error: 'Database connection failed' };
		}
		const { data: existing } = await supabase
			.from('tournament_match_games')
			.select('id, match_id')
			.eq('replay_guid', result.replayGuid)
			.maybeSingle();

		if (existing && existing.match_id !== matchId) {
			return {
				success: false,
				error: 'This replay has already been used for another tournament match'
			};
		}

		// Match players
		const playerSuggestions = await matchPlayers(result, tournamentId, teamAId, teamBId);

		// Determine suggested winner
		let suggestedWinner: string | null = null;
		if (result.winnerTeam === 0) {
			suggestedWinner = teamAId;
		} else if (result.winnerTeam === 1) {
			suggestedWinner = teamBId;
		}

		return {
			success: true,
			suggestions: {
				suggestedWinner,
				playerSuggestions,
				replayGuid: result.replayGuid,
				changelist: result.changelist,
				warnings: result.warnings
			}
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Failed to parse replay file'
		};
	}
}

/**
 * Check if a replay GUID has already been used.
 */
export async function checkReplayGuidExists(guid: string): Promise<boolean> {
	const supabase = getSupabaseAdminClient();
	if (!supabase) {
		return false;
	}
	const { data } = await supabase
		.from('tournament_match_games')
		.select('id')
		.eq('replay_guid', guid)
		.maybeSingle();

	return data !== null;
}
