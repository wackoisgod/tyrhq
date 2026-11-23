import { handleReplayWorkerMessage } from './worker-protocol';

const scope = self as unknown as {
	onmessage: ((event: MessageEvent) => void) | null;
	postMessage: (message: unknown) => void;
};

scope.onmessage = (event: MessageEvent) => {
	handleReplayWorkerMessage(event.data, (message) => {
		scope.postMessage(message);
	});
};
