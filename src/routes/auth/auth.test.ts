import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from './$types';

vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_SITE_URL: 'https://www.tyrhq.com' }
}));

import { actions } from './+page.server';

function authEvent(origin: string) {
	const auth = {
		signUp: vi.fn().mockResolvedValue({ error: null }),
		resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null })
	};
	const url = new URL('/auth', origin);
	const event = {
		url,
		request: new Request(url, {
			method: 'POST',
			body: new URLSearchParams({ email: 'pilot@example.test', password: 'test-password' })
		}),
		locals: { supabase: { auth } }
	} as unknown as RequestEvent;

	return { auth, event };
}

describe.each(['https://preview.example.test', 'https://www.tyrhq.com'])(
	'email authentication from %s',
	(origin) => {
		it('requests signup confirmation on the initiating origin', async () => {
			const { auth, event } = authEvent(origin);

			await actions.signup(event);

			expect(auth.signUp).toHaveBeenCalledWith({
				email: 'pilot@example.test',
				password: 'test-password',
				options: { emailRedirectTo: `${origin}/auth/callback` }
			});
		});

		it('requests password recovery on the initiating origin', async () => {
			const { auth, event } = authEvent(origin);

			await actions.forgot(event);

			expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('pilot@example.test', {
				redirectTo: `${origin}/auth/callback?next=%2Fauth`
			});
		});
	}
);
