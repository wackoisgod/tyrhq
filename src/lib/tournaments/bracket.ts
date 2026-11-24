export function getSnakeSeedOrder(bracketSize: number) {
	if (
		!Number.isInteger(bracketSize) ||
		bracketSize < 2 ||
		(bracketSize & (bracketSize - 1)) !== 0
	) {
		throw new Error('Bracket size must be a power of two greater than one.');
	}

	let seeds = [1, 2];
	for (let size = 4; size <= bracketSize; size *= 2) {
		const oppositeSeed = size + 1;
		seeds = seeds.flatMap((seed) => [seed, oppositeSeed - seed]);
	}

	return seeds;
}

export function getSnakeFirstRoundSeeds(teamCount: number) {
	if (!Number.isInteger(teamCount) || teamCount < 2) {
		throw new Error('At least two teams are required.');
	}

	const bracketSize = 2 ** Math.ceil(Math.log2(teamCount));
	const slots = getSnakeSeedOrder(bracketSize);
	const matches: [number | null, number | null][] = [];

	for (let index = 0; index < slots.length; index += 2) {
		const seedA = slots[index]!;
		const seedB = slots[index + 1]!;
		matches.push([seedA <= teamCount ? seedA : null, seedB <= teamCount ? seedB : null]);
	}

	return matches;
}
