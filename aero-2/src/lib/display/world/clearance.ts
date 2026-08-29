/**
 * clearance.ts — how high the ground is under the aircraft, and whether we
 * actually measured it.
 *
 * `place.groundElevationM` is one number for a whole region, and it is NOT a
 * terrain clearance: measured against the real DEM across each orbit, mean plus
 * climb floor sits BELOW the local peak at five of eleven locations — Las Vegas
 * by 2,072 m, Dubai by 1,119 m, Mumbai by 990 m. So the renderer is asked what
 * the ground really is, and the mean is only the floor.
 *
 * That policy lived twice, once in each renderer bridge, and the two engines
 * disagreeing about where the ground is has already been a documented
 * regression: the same location flew clean on MapLibre and through a mountain
 * on Cesium. One policy, one place, two callers.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO is convert between vertical frames. The
 * two engines sample in different ones — MapLibre's `queryTerrainElevation`
 * returns the DRAWN height with exaggeration already applied, Cesium's
 * `globe.getHeight` returns real metres MSL — so each caller passes its mean
 * and its sample already in its own frame. Folding exaggeration in here would
 * silently scale Cesium's floor by a factor it never applied.
 */

export interface Clearance {
	/** Ground height to fly above, in the caller's own vertical frame. */
	groundM: number;
	/**
	 * Did the terrain actually answer?
	 *
	 * This is the whole reason the function returns an object rather than a
	 * number. The failure mode this codebase keeps paying for is an absence
	 * that reads as a measurement, and here it is invisible by construction:
	 * when no DEM tile has decoded, the query returns nothing, the mean wins,
	 * and the camera flies a perfectly reasonable altitude over ground drawn at
	 * sea level. Nothing is thrown and nothing looks wrong. The only way to
	 * know is to count how often this was false — see `AeroDisplay.terrain`.
	 */
	sampled: boolean;
}

/**
 * The regional mean is the FLOOR; a real terrain sample wins when it is higher.
 *
 * A tile that has not loaded yet must never be able to lower the camera, so
 * anything non-finite — null, undefined, NaN — falls back to the mean rather
 * than to zero. `Math.max(mean, sample ?? 0)` gets the same answer for land,
 * but it routes "unknown" through a literal sea level on the way, and that is
 * the substitution worth not writing down.
 */
export function resolveClearance(
	meanGroundM: number,
	sampledM: number | null | undefined
): Clearance {
	if (typeof sampledM !== 'number' || !Number.isFinite(sampledM)) {
		return { groundM: meanGroundM, sampled: false };
	}
	return { groundM: Math.max(meanGroundM, sampledM), sampled: true };
}
