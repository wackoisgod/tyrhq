/**
 * Formula used by column P, "Real Acceleration (m/s²)", in the Tyr stats sheet:
 * https://docs.google.com/spreadsheets/d/19rKxn0U56gF7PdhunLjjNpg-2shwyWRozNqfc8S2RRo/edit?gid=0#gid=0
 */
export function calculateRealAccelerationMps2(
	maxSpeedKph: number,
	accelerationTimeSeconds: number
): number {
	if (
		!Number.isFinite(maxSpeedKph) ||
		!Number.isFinite(accelerationTimeSeconds) ||
		maxSpeedKph <= 0 ||
		accelerationTimeSeconds <= 0
	) {
		return 0;
	}

	return maxSpeedKph / (accelerationTimeSeconds * 3.8);
}
