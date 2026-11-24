import { describe, expect, it } from 'vitest';

import { buildReplayAutoFill, releasedMapIdForLevelName, replayStatRows, type RegisteredPlayer } from './auto-fill';
import type { ReplayUploadPayload } from './upload-payload';

const teamA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const teamB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const alice = '11111111-1111-1111-1111-111111111111';
const bob = '22222222-2222-2222-2222-222222222222';
const carol = '33333333-3333-3333-3333-333333333333';

function payload(
	overrides: Partial<Omit<ReplayUploadPayload, 'replayGuid'>> = {}
): ReplayUploadPayload & { replayGuid: string } {
	return {
		replayGuid: '89d31bb46e93b24b897a1749f392104a',
		changelist: 40016,
		levelName: null,
		winnerTeam: 0,
		roster: [
			{ name: 'Alice', teamId: 0, steamId: '76561198000000001', clan: null },
			{ name: 'Bob', teamId: 0, steamId: '76561198000000002', clan: null },
			{ name: 'Carol', teamId: 1, steamId: '76561198000000003', clan: 'Ravine' }
		],
		endgameStats: [
			{
				name: 'Alice',
				team: 0,
				kills: 3,
				damage: 100,
				blocked: 1,
				assist: 2,
				tankIdx: 7,
				tank: 'Bush',
				partyId: null
			},
			{
				name: 'Bob',
				team: 0,
				kills: 1,
				damage: 500,
				blocked: 0,
				assist: 0,
				tankIdx: 11,
				tank: 'Healer',
				partyId: null
			},
			{
				name: 'Carol',
				team: 1,
				kills: 5,
				damage: 900,
				blocked: 4,
				assist: 1,
				tankIdx: 5,
				tank: 'Blink',
				partyId: 'party-1'
			}
		],
		warnings: [],
		...overrides
	};
}

const players: RegisteredPlayer[] = [
	{ userId: alice, teamId: teamA, displayName: 'Alice', steamId: '76561198000000001' },
	{ userId: bob, teamId: teamA, displayName: 'Bob', steamId: '76561198000000002' },
	{ userId: carol, teamId: teamB, displayName: 'Carol', steamId: '76561198000000003' }
];

describe('replay map autofill', () => {
	it('maps the Ravine replay level onto the released Ravine map', () => {
		expect(releasedMapIdForLevelName('/TyrMapRavine/Maps/Map_Ravine')).toBe('ravine');
		expect(releasedMapIdForLevelName('Map_Ravine')).toBe('ravine');
	});

	it('leaves the map empty when the level is missing or not a released map', () => {
		expect(releasedMapIdForLevelName(null)).toBeNull();
		expect(releasedMapIdForLevelName('/TyrMapGlade/Maps/Map_Glade')).toBeNull();
		expect(releasedMapIdForLevelName('not a map')).toBeNull();
	});

	it('suggests Ravine on the scoreboard autofill', () => {
		const fill = buildReplayAutoFill({
			payload: payload({ levelName: '/TyrMapRavine/Maps/Map_Ravine' }),
			teamAId: teamA,
			teamBId: teamB,
			players
		});
		expect(fill.suggestedMapId).toBe('ravine');
	});
});

describe('replay auto-fill', () => {
	it('matches Steam IDs, ranks the winning side first, and maps tank codenames', () => {
		const fill = buildReplayAutoFill({
			payload: payload(),
			teamAId: teamA,
			teamBId: teamB,
			players,
			vehicles: [{ id: 'bush', key: 'Gameplay.Vehicle.Bush', name: 'Ark' }]
		});

		expect(fill.suggestedWinnerTeamId).toBe(teamA);
		expect(fill.teamsSwapped).toBe(false);
		expect(fill.teamPlacements).toEqual([
			{ teamId: teamA, replayTeam: 0, placement: 1 },
			{ teamId: teamB, replayTeam: 1, placement: 2 }
		]);
		expect(fill.players.map((player) => [player.name, player.placement, player.matchedUserId, player.vehicleName])).toEqual([
			['Alice', 1, alice, 'Ark'],
			['Bob', 2, bob, 'Healer'],
			['Carol', 3, carol, 'Blink']
		]);
		expect(fill.players.every((player) => player.matchMethod === 'steam_id' && !player.teamMismatch)).toBe(true);
	});

	it('lines replay sides up from Steam IDs when team 0 is not team A', () => {
		const fill = buildReplayAutoFill({
			payload: payload({
				winnerTeam: 1,
				roster: [
					{ name: 'Alice', teamId: 1, steamId: '76561198000000001', clan: null },
					{ name: 'Carol', teamId: 0, steamId: '76561198000000003', clan: null }
				]
			}),
			teamAId: teamA,
			teamBId: teamB,
			players
		});

		expect(fill.teamsSwapped).toBe(true);
		expect(fill.suggestedWinnerTeamId).toBe(teamA);
		expect(fill.teamPlacements).toEqual([
			{ teamId: teamB, replayTeam: 0, placement: 2 },
			{ teamId: teamA, replayTeam: 1, placement: 1 }
		]);
		expect(fill.warnings).toContain('Replay sides were lined up using Steam IDs.');
		expect(fill.players.find((player) => player.name === 'Alice')?.teamMismatch).toBe(false);
	});

	it('falls back to a unique display name and leaves ambiguous names unmatched', () => {
		const fill = buildReplayAutoFill({
			payload: payload({
				winnerTeam: null,
				roster: [
					{ name: 'Alice', teamId: 0, steamId: null, clan: null },
					{ name: 'Twin', teamId: 1, steamId: null, clan: null }
				],
				endgameStats: []
			}),
			teamAId: teamA,
			teamBId: teamB,
			players: [
				{ userId: alice, teamId: teamA, displayName: 'Alice', steamId: null },
				{ userId: bob, teamId: teamA, displayName: 'Twin', steamId: null },
				{ userId: carol, teamId: teamB, displayName: 'Twin', steamId: null }
			]
		});

		expect(fill.suggestedWinnerTeamId).toBeNull();
		expect(fill.teamPlacements.every((side) => side.placement === null)).toBe(true);
		expect(fill.players.find((player) => player.name === 'Alice')).toMatchObject({
			matchedUserId: alice,
			matchMethod: 'display_name'
		});
		expect(fill.players.find((player) => player.name === 'Twin')).toMatchObject({
			matchedUserId: null,
			matchMethod: 'unmatched'
		});
	});

	it('prefers a Steam match over a display name and does not reuse an account', () => {
		const fill = buildReplayAutoFill({
			payload: payload({
				roster: [
					{ name: 'Not Alice', teamId: 0, steamId: '76561198000000001', clan: null },
					{ name: 'Alice', teamId: 1, steamId: null, clan: null }
				],
				endgameStats: []
			}),
			teamAId: teamA,
			teamBId: teamB,
			players
		});

		const byName = Object.fromEntries(fill.players.map((player) => [player.name, player]));
		expect(byName['Not Alice']).toMatchObject({ matchedUserId: alice, matchMethod: 'steam_id' });
		expect(byName.Alice).toMatchObject({ matchedUserId: null, matchMethod: 'unmatched' });
	});

	it('flags a Steam match whose registered team disagrees with the replay side', () => {
		const fill = buildReplayAutoFill({
			payload: payload({
				roster: [
					{ name: 'Alice', teamId: 0, steamId: '76561198000000001', clan: null },
					{ name: 'Carol', teamId: 0, steamId: '76561198000000003', clan: null }
				]
			}),
			teamAId: teamA,
			teamBId: teamB,
			players
		});

		expect(fill.players.find((player) => player.name === 'Carol')?.teamMismatch).toBe(true);
	});

	it('saves only checked matched players', () => {
		const fill = buildReplayAutoFill({
			payload: payload(),
			teamAId: teamA,
			teamBId: teamB,
			players
		});
		const rows = replayStatRows(fill, [alice, '99999999-9999-9999-9999-999999999999', alice]);
		expect(rows).toEqual([
			{
				userId: alice,
				teamId: teamA,
				placement: 1,
				kills: 3,
				damage: 100,
				blocked: 1,
				assist: 2,
				tankCodename: 'Bush',
				partyId: null
			}
		]);
	});
});
