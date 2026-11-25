/** Who may open /tournaments/manage and see the Settings shortcut to it. */
export function canManageTournaments(actor: {
	role?: string | null;
	isOrganizer?: boolean | null;
}) {
	return actor.role === 'admin' || Boolean(actor.isOrganizer);
}
