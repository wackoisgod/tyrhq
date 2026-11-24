import { toReplayUploadPayload, type ReplayUploadPayload } from '$lib/replay/upload-payload';

import { parseReplay, type ReplayParseProgress } from './parser';

const MAX_REPLAY_BYTES = 100 * 1024 * 1024;

export interface ReplayWorkerInbound {
	type: 'parse';
	buffer: ArrayBuffer;
}

export type ReplayWorkerOutbound =
	| ({ type: 'progress' } & ReplayParseProgress)
	| { type: 'result'; payload: ReplayUploadPayload }
	| { type: 'error'; message: string };

function isArrayBuffer(value: unknown): value is ArrayBuffer {
	return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

function isParseRequest(data: unknown): data is ReplayWorkerInbound {
	if (!data || typeof data !== 'object') return false;
	const message = data as { type?: unknown; buffer?: unknown };
	return message.type === 'parse' && isArrayBuffer(message.buffer);
}

/**
 * Worker entry logic, separated so tests can run it without a Worker thread.
 * Emits progress, then either a slim payload or an error. Never emits file bytes.
 */
export function handleReplayWorkerMessage(
	data: unknown,
	emit: (message: ReplayWorkerOutbound) => void,
	limits?: { maxBytes?: number }
): void {
	if (!isParseRequest(data)) {
		emit({ type: 'error', message: 'Invalid worker request.' });
		return;
	}
	if (data.buffer.byteLength > (limits?.maxBytes ?? MAX_REPLAY_BYTES)) {
		emit({ type: 'error', message: 'Replay file is too large.' });
		return;
	}
	try {
		const result = parseReplay(new Uint8Array(data.buffer), {
			onProgress: (progress) => emit({ type: 'progress', ...progress })
		});
		emit({ type: 'result', payload: toReplayUploadPayload(result) });
	} catch (error) {
		emit({
			type: 'error',
			message: error instanceof Error ? error.message : 'Replay parse failed.'
		});
	}
}
