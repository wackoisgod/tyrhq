/**
 * Link an email address, then set a password only if that link was accepted.
 * A taken address starts an account merge and must not change the current password.
 */

export interface EmailUpdateError {
	message?: string;
	code?: string;
	error_code?: string;
}

export interface EmailLinkAuth {
	updateUser: (
		attributes: { email?: string; password?: string },
		options?: { emailRedirectTo?: string }
	) => Promise<{ error: EmailUpdateError | null }>;
}

export type LinkEmailResult =
	| { status: 'pending' }
	| { status: 'merge' }
	| { status: 'email-failed' }
	| { status: 'password-failed' };

export function isEmailTakenError(error: EmailUpdateError | null): boolean {
	if (!error) return false;
	const errorCode = error.code || error.error_code;
	return (
		errorCode === 'email_exists' ||
		errorCode === 'email_address_taken' ||
		Boolean(error.message?.toLowerCase().includes('already')) ||
		Boolean(error.message?.toLowerCase().includes('exists'))
	);
}

export async function linkEmailThenPassword(
	auth: EmailLinkAuth,
	input: { email: string; password: string; emailRedirectTo: string }
): Promise<LinkEmailResult> {
	const { error: emailError } = await auth.updateUser(
		{ email: input.email },
		{ emailRedirectTo: input.emailRedirectTo }
	);
	if (emailError) {
		return { status: isEmailTakenError(emailError) ? 'merge' : 'email-failed' };
	}

	const { error: passwordError } = await auth.updateUser({ password: input.password });
	if (passwordError) return { status: 'password-failed' };
	return { status: 'pending' };
}
