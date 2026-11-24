const BLOCKED_TERMS = [
	'anal',
	'asshole',
	'bitch',
	'cunt',
	'fag',
	'faggot',
	'fuck',
	'hitler',
	'kike',
	'nazi',
	'nigger',
	'nigga',
	'rape',
	'retard',
	'shit',
	'slut',
	'tranny',
	'whore'
];

const LEET: Record<string, string> = {
	'0': 'o',
	'1': 'i',
	'3': 'e',
	'4': 'a',
	'5': 's',
	'7': 't',
	'@': 'a',
	'$': 's',
	'!': 'i',
	'+': 't'
};

export function normalizeTeamNameForSafety(name: string) {
	return name
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[013457@$!+]/g, (char) => LEET[char] ?? char)
		.replace(/[^a-z]/g, '');
}

export function findBlockedTeamNameTerm(name: string) {
	const normalized = normalizeTeamNameForSafety(name);
	return BLOCKED_TERMS.find((term) => normalized.includes(term)) ?? null;
}

export function assertTeamNameAllowed(name: string) {
	const blocked = findBlockedTeamNameTerm(name);
	if (blocked) {
		throw new TournamentError(
			'That team name is not allowed. Choose a different public team name.',
			400
		);
	}
}

export class TournamentError extends Error {
	readonly statusCode: number;
	constructor(message: string, statusCode = 400) {
		super(message);
		this.name = 'TournamentError';
		this.statusCode = statusCode;
	}
}
