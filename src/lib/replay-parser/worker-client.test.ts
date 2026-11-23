import { describe, expect, it } from 'vitest';

import type { ReplayParseResult } from './types';
import { toReplayUploadPayload } from '$lib/replay/upload-payload';
import { replayUploadPayloadSchema } from '$lib/replay/upload-payload.schema';
import { handleReplayWorkerMessage, type ReplayWorkerOutbound } from './worker-protocol';
import { parseReplayOnPort, type ReplayWorkerPort } from './worker-client';

function collect(data: unknown) {
	const messages: ReplayWorkerOutbound[] = [];
	handleReplayWorkerMessage(data, (message) => messages.push(message));
	return messages;
}

describe('replay worker protocol', () => {
	it('rejects a request that is not a parse job', () => {
		expect(collect({ type: 'parse', buffer: 'nope' })).toEqual([
			{ type: 'error', message: 'Invalid worker request.' }
		]);
	});

	it('reports progress and a slim payload for an unreadable file', () => {
		const messages = collect({ type: 'parse', buffer: new ArrayBuffer(8) });
		expect(messages.some((message) => message.type === 'progress')).toBe(true);
		const result = messages.at(-1);
		expect(result?.type).toBe('result');
		if (result?.type !== 'result') return;
		expect(result.payload.replayGuid).toBeNull();
		expect(result.payload.roster).toEqual([]);
		expect(JSON.stringify(result.payload)).not.toContain('channels');
		expect(messages.map((message) => message.type).at(-1)).toBe('result');
	});

	it('rejects files over the size limit before parsing', () => {
		const messages: ReplayWorkerOutbound[] = [];
		handleReplayWorkerMessage({ type: 'parse', buffer: new ArrayBuffer(8) }, (message) => messages.push(message), {
			maxBytes: 4
		});
		expect(messages).toEqual([{ type: 'error', message: 'Replay file is too large.' }]);
	});
});

describe('replay upload payload', () => {
	it('drops channel ids and keeps the scoreboard fields the server accepts', () => {
		const parsed = {
			roster: [
				{
					name: 'wacko',
					teamId: 0,
					steamId: '76561197960747885',
					clan: 'Technotise',
					channels: [6, 28]
				}
			],
			endgameStats: [
				{
					name: 'wacko',
					team: 0,
					kills: 2,
					damage: 400,
					blocked: 10,
					assist: 0,
					tankIdx: 7,
					tank: 'Bush',
					partyId: null
				}
			],
			winnerTeam: 0,
			replayGuid: '89D31BB46E93B24B897A1749F392104A',
			changelist: 38646,
			warnings: ['partial']
		} as ReplayParseResult;

		const payload = toReplayUploadPayload(parsed);
		expect(payload.replayGuid).toBe('89d31bb46e93b24b897a1749f392104a');
		expect(payload.roster).toEqual([
			{ name: 'wacko', teamId: 0, steamId: '76561197960747885', clan: 'Technotise' }
		]);
		expect(payload.endgameStats[0]?.tank).toBe('Bush');
		expect(payload.winnerTeam).toBe(0);
		expect('channels' in (payload.roster[0] ?? {})).toBe(false);
		expect(replayUploadPayloadSchema.parse(payload).replayGuid).toBe(payload.replayGuid);
	});

	it('rejects a payload that still carries parser internals', () => {
		const parsed = replayUploadPayloadSchema.safeParse({
			replayGuid: '89d31bb46e93b24b897a1749f392104a',
			changelist: 1,
			winnerTeam: 1,
			roster: [{ name: 'a', teamId: 0, steamId: null, clan: null, channels: [1] }],
			endgameStats: [],
			warnings: []
		});
		expect(parsed.success).toBe(false);
	});
});

describe('replay worker client', () => {
	it('resolves the parsed payload and forwards progress', async () => {
		const progress: string[] = [];
		const payload = {
			replayGuid: '89d31bb46e93b24b897a1749f392104a',
			changelist: 1,
			winnerTeam: 1 as const,
			roster: [],
			endgameStats: [],
			warnings: []
		};
		const port: ReplayWorkerPort = {
			onmessage: null,
			onerror: null,
			terminate: () => undefined,
			postMessage: () => {
				port.onmessage?.({
					data: { type: 'progress', phase: 'header', fraction: 0.02 }
				} as MessageEvent);
				port.onmessage?.({ data: { type: 'result', payload } } as MessageEvent);
			}
		};

		await expect(
			parseReplayOnPort(port, new ArrayBuffer(4), (update) => progress.push(update.phase))
		).resolves.toEqual(payload);
		expect(progress).toEqual(['header']);
	});

	it('rejects when the worker reports an error', async () => {
		const port: ReplayWorkerPort = {
			onmessage: null,
			onerror: null,
			terminate: () => undefined,
			postMessage: () => {
				port.onmessage?.({ data: { type: 'error', message: 'bad replay' } } as MessageEvent);
			}
		};
		await expect(parseReplayOnPort(port, new ArrayBuffer(4))).rejects.toThrow('bad replay');
	});

	it('transfers file bytes to the real parse handler', async () => {
		const buffer = await new Blob([new Uint8Array([1, 2, 3, 4])]).arrayBuffer();
		const phases: string[] = [];
		const port: ReplayWorkerPort = {
			onmessage: null,
			onerror: null,
			terminate: () => undefined,
			postMessage: (message, transfer) => {
				expect(transfer?.[0]).toBe(buffer);
				expect(message.type).toBe('parse');
				handleReplayWorkerMessage(message, (outbound) => {
					port.onmessage?.({ data: outbound } as MessageEvent);
				});
			}
		};
		const payload = await parseReplayOnPort(port, buffer, (update) => phases.push(update.phase));
		expect(payload.replayGuid).toBeNull();
		expect(phases.length).toBeGreaterThan(0);
		expect(JSON.stringify(payload)).not.toContain('channels');
	});
});
