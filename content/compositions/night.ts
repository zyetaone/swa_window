/**
 * Night palette — authored sky-state targets for the Cesium scene.
 *
 * Up until now, every night tunable lived inline in world/compose.ts as
 * a literal number inside a lerp() call. Editing the dawn warmth meant
 * hunting through a 200-line tick function for `dd * 0.15`. Now the
 * targets live here, grouped by what they DO, and compose.ts becomes a
 * reader of NIGHT_PALETTE.
 *
 * Compose pattern across the board:
 *
 *     value = lerp(P.day, P.night, nightFactor)
 *           + (dawnDuskFactor * P.duskBias)   -- additive bias at dusk peak
 *
 * Or, when the dusk bias is multiplicative (globeColor):
 *
 *     value = lerp(lerp(P.day, P.night, nf), P.duskBias, dd * P.duskWeight)
 *
 * Both shapes match the existing compose.ts math — this is a relocation
 * of authoring data, not a re-tuning. To re-tune the night look, edit
 * the numbers in this file.
 *
 * Why under content/ and not lib/world/: these are AESTHETIC targets a
 * curator could legitimately change. The math that consumes them is
 * engine code and stays in lib/world/.
 */

export const NIGHT_PALETTE = {
	/**
	 * Cesium globe baseColor (uint8 RGB). Lerps day → night with nightFactor,
	 * then biases toward duskBias proportional to dawnDuskFactor × duskWeight.
	 *
	 * Past attempts: dd=0.3 gave a "brownish globe" at dusk peak. dd=0.15 is
	 * the sweet spot — warm influence without the mud.
	 */
	globeColor: {
		day:       [140, 170, 200] as const,
		night:     [25, 25, 40]    as const,
		duskBias:  [110, 90, 80]   as const,
		duskWeight: 0.15,
	},

	/**
	 * scene.skyAtmosphere shift uniforms. brShift is also multiplied by
	 * world.skyDarken (operator knob) at consume site.
	 *
	 * Past attempts: satShift dd contribution was -0.5 (killed Cesium's warm
	 * sunset scatter). -0.08 retains warmth while cancelling cyan edge.
	 */
	skyAtmosphere: {
		satShift: { day: 0, night: -0.8, duskBias: -0.08 },
		brShift:  { day: 0, night: -0.3, duskBias: -0.02 },
	},

	/**
	 * scene.postProcessStages.exposure + globe.atmosphereLightIntensity.
	 * Day values are Cesium defaults; night targets are operator-tunable via
	 * world.nightExposure / world.atmosphereLight so we read those at runtime.
	 */
	scene: {
		exposureDay:        1.0,
		atmosphereLightDay: 10.0,
	},

	/**
	 * VIIRS Black Marble alpha ceiling at deep night. The NASA tiles paint
	 * a uniform amber wash at 1.0 — capping at 0.5 keeps them reading as
	 * "lit terrain" on top of the shader-darkened base. Previously lived
	 * in $lib/night/index.ts; consolidating into the palette so all night
	 * targets sit in one file.
	 */
	viirs: {
		maxAlpha:         0.5,
		smoothstepFloor:  0.55,
		smoothstepCeil:   0.9,
	},

	/**
	 * CSS warm-glow city dome peak opacity (Pane.svelte .map-warm-glow).
	 * Multiplied by nightFactor × nightLightScale × location.scene.nightLightDensity
	 * at the consume site so the dome fades with time, user knob, and place.
	 */
	warmGlow: {
		peak: 0.55,
	},
} as const;
