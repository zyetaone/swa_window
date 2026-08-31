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
 * disagreeing about where the ground is was a documented regression: the same
 * location flew clean on MapLibre and through a mountain on Cesium. The Cesium
 * bridge is deleted now and MapLibre is the only caller, so this is one policy
 * with one caller — kept, not inlined, because `sampled` is the provenance flag
 * `AeroDisplay.terrain` counts and that has to live somewhere both the caller
 * and the counter can see.
 *
 * It also still owns a vertical-frame rule worth not relearning: MapLibre's
 * `queryTerrainElevation` returns the DRAWN height with exaggeration already
 * applied, so the mean and the sample must arrive in the SAME frame. Any second
 * renderer sampling real metres MSL has to convert before it calls this, not
 * after.
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
