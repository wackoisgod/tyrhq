/**
 * POST /auth/split/init
 * Initiates splitting off a sign-in method by setting a secure split cookie
 * User must then re-authenticate with that specific method to prove ownership
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSplitCookie, getSplitSecret, SPLIT_COOKIE_NAME } from '$lib/server/account-split';
import { computeSignInMethods } from '$lib/server/sign-in-methods';

export const POST: RequestHandler = async ({ locals, cookies, request }) => {
	const { session, user } = await locals.safeGetSession();

	if (!session || !user) {
		throw error(401, 'Not authenticated');
	}

	// Verify MERGE_SECRET is configured (reused for splits)
	try {
		getSplitSecret();
	} catch (err: any) {
		console.error('[account-split] MERGE_SECRET not configured:', err);
		throw error(500, 'Account split is not configured. Please contact support.');
	}

	const body = await request.json();
	const provider = body.provider as 'google' | 'email' | 'steam';

	if (!provider || !['google', 'email', 'steam'].includes(provider)) {
		throw error(400, 'Invalid provider. Must be google, email, or steam.');
	}

	// Verify user has at least 2 sign-in methods
	const signInMethods = computeSignInMethods(user);

	if (signInMethods.count < 2) {
		throw error(400, 'Cannot split sign-in method: you must have at least 2 sign-in methods.');
	}

	// Verify user has the requested method
	let identityId: string | undefined;
	let steamId: string | undefined;

	if (provider === 'google') {
		if (!signInMethods.hasGoogle) {
			throw error(400, 'You do not have a Google sign-in method to split.');
		}
		if (!signInMethods.canUnlinkGoogle) {
			throw error(400, 'Cannot split Google: you must keep at least one sign-in method.');
		}
		const googleIdentity = user.identities?.find((i) => i.provider === 'google');
		identityId = googleIdentity?.id;
	} else if (provider === 'email') {
		if (!signInMethods.hasEmailPassword) {
			throw error(400, 'You do not have an email+password sign-in method to split.');
		}
		if (!signInMethods.canRemovePassword) {
			throw error(400, 'Cannot split email+password: you must keep at least one sign-in method.');
		}
		const emailIdentity = user.identities?.find((i) => i.provider === 'email');
		identityId = emailIdentity?.id;
	} else if (provider === 'steam') {
		if (!signInMethods.hasSteam) {
			throw error(400, 'You do not have a verified Steam sign-in method to split.');
		}
		if (!signInMethods.canUnlinkSteam) {
			throw error(400, 'Cannot split Steam: you must keep at least one sign-in method.');
		}
		const { STEAM_PROVIDER } = await import('$lib/server/steam-oidc-provider');
		const steamIdentity = user.identities?.find((i) => i.provider === STEAM_PROVIDER);
		identityId = steamIdentity?.id;
	}

	// Create split cookie
	const { value, options } = createSplitCookie(user.id, provider, identityId);

	cookies.set(SPLIT_COOKIE_NAME, value, options);

	return json({
		success: true,
		currentUserId: user.id,
		provider,
		expiresIn: options.maxAge
	});
};
