import { describe, expect, it } from 'vitest';

import { canManageTournaments } from './tournament-access';

describe('canManageTournaments', () => {
	it('matches /tournaments/manage: organizers and admins only', () => {
		expect(canManageTournaments({ role: 'user', isOrganizer: false })).toBe(false);
		expect(canManageTournaments({ role: 'contributor', isOrganizer: false })).toBe(false);
		expect(canManageTournaments({ role: 'user', isOrganizer: null })).toBe(false);
		expect(canManageTournaments({ role: 'user', isOrganizer: true })).toBe(true);
		expect(canManageTournaments({ role: 'admin', isOrganizer: false })).toBe(true);
		expect(canManageTournaments({ role: 'admin', isOrganizer: true })).toBe(true);
	});
});
