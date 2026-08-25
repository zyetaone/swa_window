/**
 * How much tessellation detail to spend at a given ground detail.
 */
import { SSE_CRUISE, SSE_GROUND } from '#lib/terrain/data.js';

export function screenSpaceErrorFor(groundDetail: number): number {
	const g = Number.isFinite(groundDetail) ? Math.min(1, Math.max(0, groundDetail)) : 0;
	return SSE_CRUISE + (SSE_GROUND - SSE_CRUISE) * g;
}
