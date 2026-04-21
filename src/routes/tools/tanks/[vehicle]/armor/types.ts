export type ArmorHitResult =
	| 'penetrate'
	| 'ricochet'
	| 'no_pen'
	| 'overmatch'
	| 'fifty_fifty'
	| 'module'
	| 'absorb';

export type ArmorHitInfo = {
	thickness: number;
	angle: number;
	isFiftyFifty: boolean;
	result: ArmorHitResult;
};
