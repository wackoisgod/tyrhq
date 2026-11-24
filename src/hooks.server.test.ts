import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

import { handle } from './hooks.server';

const origin = 'https://www.tyrhq.com';

function eventFor(pathname: string, init: RequestInit): RequestEvent {
	const request = new Request(`${origin}${pathname}`, init);
	return {
		request,
		url: new URL(request.url),
		cookies: { getAll: () => [] },
		locals: {}
	} as unknown as RequestEvent;
}

async function invoke(event: RequestEvent) {
	let resolved = false;
	const response = await handle({
		event,
		resolve: async () => {
			resolved = true;
			return new Response('ok', { status: 200 });
		}
	});
	return { response, resolved };
}

describe('handle CSRF origin check', () => {
	it('rejects a cross-site form POST to a normal route', async () => {
		const { response, resolved } = await invoke(
			eventFor('/login', {
				method: 'POST',
				headers: {
					'content-type': 'application/x-www-form-urlencoded',
					origin: 'https://evil.example'
				},
				body: 'a=1'
			})
		);

		expect(response.status).toBe(403);
		expect(await response.text()).toBe('Cross-site POST form submissions are forbidden');
		expect(resolved).toBe(false);
	});

	it('rejects a form POST that sends no Origin header', async () => {
		const { response, resolved } = await invoke(
			eventFor('/login', {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
				body: 'a=1'
			})
		);

		expect(response.status).toBe(403);
		expect(await response.text()).toBe('Cross-site POST form submissions are forbidden');
		expect(resolved).toBe(false);
	});

	it('allows a same-origin form POST', async () => {
		const { response, resolved } = await invoke(
			eventFor('/login', {
				method: 'POST',
				headers: {
					'content-type': 'application/x-www-form-urlencoded',
					origin
				},
				body: 'a=1'
			})
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('ok');
		expect(resolved).toBe(true);
	});

	it('allows POST /auth/steam/oidc/token without an Origin header', async () => {
		const { response, resolved } = await invoke(
			eventFor('/auth/steam/oidc/token', {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: 'grant_type=authorization_code'
			})
		);

		expect(response.status).toBe(200);
		expect(resolved).toBe(true);
	});

	it('allows POST /auth/steam/oidc/token from another origin', async () => {
		const { response, resolved } = await invoke(
			eventFor('/auth/steam/oidc/token?extra=1', {
				method: 'POST',
				headers: {
					'content-type': 'application/x-www-form-urlencoded',
					origin: 'https://evil.example'
				},
				body: 'grant_type=authorization_code'
			})
		);

		expect(response.status).toBe(200);
		expect(resolved).toBe(true);
	});

	it('still rejects a cross-site form POST to a nearby auth route', async () => {
		const { response, resolved } = await invoke(
			eventFor('/auth/steam/oidc/userinfo', {
				method: 'POST',
				headers: {
					'content-type': 'multipart/form-data; boundary=----',
					origin: 'https://evil.example'
				},
				body: 'a=1'
			})
		);

		expect(response.status).toBe(403);
		expect(resolved).toBe(false);
	});

	it('does not apply the origin check to a JSON POST', async () => {
		const { response, resolved } = await invoke(
			eventFor('/api/example', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					origin: 'https://evil.example'
				},
				body: '{}'
			})
		);

		expect(response.status).toBe(200);
		expect(resolved).toBe(true);
	});

	it('returns the JSON error body when Accept is application/json', async () => {
		const { response } = await invoke(
			eventFor('/login', {
				method: 'PUT',
				headers: {
					'content-type': 'text/plain',
					origin: 'https://evil.example',
					accept: 'application/json'
				},
				body: 'a=1'
			})
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			message: 'Cross-site PUT form submissions are forbidden'
		});
	});
});
