import { describe, expect, it } from 'vitest';

import { linkEmailThenPassword, type EmailLinkAuth, type EmailUpdateError } from './link-email';

function authThat(respond: (kind: 'email' | 'password') => EmailUpdateError | null) {
	const calls: Array<'email' | 'password'> = [];
	const auth: EmailLinkAuth = {
		updateUser: async (attributes) => {
			const kind = attributes.email ? 'email' : 'password';
			calls.push(kind);
			return { error: respond(kind) };
		}
	};
	return { auth, calls };
}

const input = {
	email: 'pilot@example.com',
	password: 'new-password',
	emailRedirectTo: 'https://tyrhq.test/auth/callback?next=%2Fsettings&link=email'
};

describe('link email then password', () => {
	it('sets the password only after the email update is accepted', async () => {
		const { auth, calls } = authThat(() => null);
		await expect(linkEmailThenPassword(auth, input)).resolves.toEqual({ status: 'pending' });
		expect(calls).toEqual(['email', 'password']);
	});

	it('does not change the password when the email is already taken', async () => {
		const { auth, calls } = authThat((kind) =>
			kind === 'email' ? { code: 'email_exists', message: 'Email already registered' } : null
		);
		await expect(linkEmailThenPassword(auth, input)).resolves.toEqual({ status: 'merge' });
		expect(calls).toEqual(['email']);
	});

	it('does not change the password when the email update fails for another reason', async () => {
		const { auth, calls } = authThat((kind) => (kind === 'email' ? { message: 'rate limit' } : null));
		await expect(linkEmailThenPassword(auth, input)).resolves.toEqual({ status: 'email-failed' });
		expect(calls).toEqual(['email']);
	});
});
