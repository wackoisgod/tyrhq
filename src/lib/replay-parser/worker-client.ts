import type { ReplayParseProgress } from './parser';
import type { ReplayWorkerInbound, ReplayWorkerOutbound } from './worker-protocol';
import type { ReplayUploadPayload } from '$lib/replay/upload-payload';

export interface ReplayWorkerPort {
	postMessage(message: ReplayWorkerInbound, transfer?: Transferable[]): void;
	terminate(): void;
	onmessage: ((this: ReplayWorkerPort, event: MessageEvent<ReplayWorkerOutbound>) => void) | null;
	onerror: ((this: ReplayWorkerPort, event: Event) => void) | null;
}

/**
 * Drive a worker-shaped port. The port receives the file bytes and returns
 * progress plus the parsed payload. The bytes are transferred, not copied back.
 */
export function parseReplayOnPort(
	port: ReplayWorkerPort,
	buffer: ArrayBuffer,
	onProgress?: (progress: ReplayParseProgress) => void
): Promise<ReplayUploadPayload> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (error?: Error, payload?: ReplayUploadPayload) => {
			if (settled) return;
			settled = true;
			port.onmessage = null;
			port.onerror = null;
			port.terminate();
			if (error) reject(error);
			else resolve(payload as ReplayUploadPayload);
		};

		port.onmessage = (event) => {
			const message = event.data;
			if (!message || typeof message !== 'object') {
				finish(new Error('Replay worker returned an invalid message.'));
				return;
			}
			if (message.type === 'progress') {
				onProgress?.(message);
				return;
			}
			if (message.type === 'result') {
				finish(undefined, message.payload);
				return;
			}
			if (message.type === 'error') {
				finish(new Error(message.message || 'Replay parse failed.'));
				return;
			}
			finish(new Error('Replay worker returned an invalid message.'));
		};
		port.onerror = () => {
			finish(new Error('Replay worker failed.'));
		};

		try {
			port.postMessage({ type: 'parse', buffer }, [buffer]);
		} catch (error) {
			finish(error instanceof Error ? error : new Error('Could not start the replay parser.'));
		}
	});
}

function createReplayWorker(): ReplayWorkerPort {
	const worker = new Worker(new URL('./replay.worker.ts', import.meta.url), { type: 'module' });
	const port: ReplayWorkerPort = {
		onmessage: null,
		onerror: null,
		postMessage: (message, transfer) => {
			worker.postMessage(message, transfer ?? []);
		},
		terminate: () => worker.terminate()
	};
	worker.onmessage = (event: MessageEvent<ReplayWorkerOutbound>) => {
		port.onmessage?.({ data: event.data } as MessageEvent<ReplayWorkerOutbound>);
	};
	worker.onerror = (event) => {
		port.onerror?.(event);
	};
	return port;
}

/**
 * Parse a replay file in a dedicated worker. Call this from a browser event.
 */
export function parseReplayFile(
	file: Blob,
	onProgress?: (progress: ReplayParseProgress) => void
): Promise<ReplayUploadPayload> {
	const worker = createReplayWorker();
	return file.arrayBuffer().then(
		(buffer) => parseReplayOnPort(worker, buffer, onProgress),
		(error: unknown) => {
			worker.terminate();
			throw error instanceof Error ? error : new Error('Could not read the replay file.');
		}
	);
}
