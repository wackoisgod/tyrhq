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

	// Map provider to identity provider name and validation
	const { STEAM_PROVIDER } = await import('$lib/server/steam-oidc-provider');
	const providerConfig: Record<string, {
		identityProvider: string;
		hasMethod: boolean;
		canUnlink: boolean;
		errorName: string;
	}> = {
		google: {
			identityProvider: 'google',
			hasMethod: signInMethods.hasGoogle,
			canUnlink: signInMethods.canUnlinkGoogle,
			errorName: 'Google'
		},
		email: {
			identityProvider: 'email',
			hasMethod: signInMethods.hasEmailPassword,
			canUnlink: signInMethods.canRemovePassword,
			errorName: 'email+password'
		},
		steam: {
			identityProvider: STEAM_PROVIDER,
			hasMethod: signInMethods.hasSteam,
			canUnlink: signInMethods.canUnlinkSteam,
			errorName: 'Steam'
		}
	};

	const config = providerConfig[provider];
	if (!config) {
		throw error(400, `Unsupported provider: ${provider}`);
	}

	if (!config.hasMethod) {
		throw error(400, `You do not have a ${config.errorName} sign-in method to split.`);
	}

	if (!config.canUnlink) {
		throw error(400, `Cannot split ${config.errorName}: you must keep at least one sign-in method.`);
	}

	// Find the identity
	const identity = user.identities?.find((i) => i.provider === config.identityProvider);
	const identityId = identity?.id;

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
