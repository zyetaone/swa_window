export function normalizeHeading(deg: number): number {
	return ((deg % 360) + 360) % 360;
}
