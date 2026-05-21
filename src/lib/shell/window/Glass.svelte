<script lang="ts">
	/**
	 * Glass — the fixed-to-glass chrome layers over the viewport.
	 *
	 * Phase 15.5: previously 3 separate DOM elements (glass-vignette z:9,
	 * vignette z:10, glass-recess z:11). Collapsed into ONE element with
	 * stacked `background-image` gradients + an inset `box-shadow` for the
	 * rim recess. Saves 2 DOM elements per frame; identical visual.
	 *
	 * The glass-vignette ring is opacity-reactive (darker at night). Driven
	 * by a CSS custom property registered with `@property` so it can be
	 * transitioned smoothly via CSS — otherwise the rim-darkening would
	 * snap rather than fade across sky-state transitions.
	 *
	 * pointer-events: none + decorative. Sits ABOVE the motion-transformed
	 * .scene-content so it doesn't jitter with turbulence (glass is fixed
	 * to the cabin, not the world).
	 */
	interface Props {
		glassVignetteOpacity: number;
	}
	let { glassVignetteOpacity }: Props = $props();
</script>

<div class="glass" style:--glass-vignette-opacity={glassVignetteOpacity}></div>

<style>
	/* Registered custom property — required for CSS transition to interpolate
	   the rim-darkening across sky-state changes. Without @property, the
	   variable is treated as a string and the transition snaps. */
	@property --glass-vignette-opacity {
		syntax: '<number>';
		initial-value: 1;
		inherits: false;
	}

	.glass {
		position: absolute;
		inset: 0;
		pointer-events: none;
		border-radius: inherit;
		z-index: 11;
		/* Two stacked radial gradients + inset box-shadow = the three
		   original layers in one element. First gradient = rim darkening
		   (opacity-reactive); second gradient = corner vignette (static);
		   box-shadow = rim depth shadow. */
		background:
			radial-gradient(
				circle at center,
				transparent 50%,
				rgba(0, 0, 0, calc(var(--glass-vignette-opacity, 1) * 0.6)) 100%
			),
			radial-gradient(
				ellipse 75% 65% at 50% 50%,
				transparent 55%,
				rgba(0, 0, 0, 0.08) 80%,
				rgba(0, 0, 0, 0.3) 100%
			);
		box-shadow:
			inset 0 0 10px 4px rgba(0, 0, 0, 0.25),
			inset 2px 2px 6px rgba(0, 0, 0, 0.15);
		transition: --glass-vignette-opacity 2s;
	}
</style>
