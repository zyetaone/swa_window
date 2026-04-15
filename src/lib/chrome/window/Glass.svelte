<script lang="ts">
	/**
	 * Glass — the fixed-to-glass chrome layers over the viewport:
	 *   z:9  — glass-surface + glass-vignette (darkens the rim-out area)
	 *   z:10 — vignette (soft dark corners)
	 *   z:11 — glass-recess (rim depth shadow)
	 *
	 * All three are pointer-events: none and decorative. They sit ABOVE the
	 * motion-transformed .scene-content so they don't jitter with turbulence
	 * — glass is physically attached to the cabin, not to the world.
	 *
	 * vignette opacity depends on sky state (darker at night), driven by
	 * a single prop from the parent.
	 */
	interface Props {
		glassVignetteOpacity: number;
	}
	let { glassVignetteOpacity }: Props = $props();
</script>

<!-- z:9 — glass vignette (darkens the rim-out perimeter) -->
<div class="glass-surface" style:z-index={9}>
	<div class="glass-vignette" style:opacity={glassVignetteOpacity}></div>
</div>

<!-- z:10 — outer soft vignette -->
<div class="vignette" style:z-index={10}></div>

<!-- z:11 — glass recess rim shadow (depth illusion) -->
<div class="glass-recess" style:z-index={11}></div>

<style>
	.glass-recess {
		position: absolute;
		inset: 0;
		pointer-events: none;
		border-radius: inherit;
		box-shadow:
			/* Gentle recess where glass meets the metallic rim */
			inset 0 0 10px 4px rgba(0, 0, 0, 0.25),
			inset 2px 2px 6px rgba(0, 0, 0, 0.15);
	}

	.glass-surface {
		position: absolute;
		inset: 0;
		pointer-events: none;
		border-radius: inherit;
		overflow: hidden;
	}

	.glass-vignette {
		position: absolute;
		inset: 0;
		background: radial-gradient(
			circle at center,
			transparent 50%,
			rgba(0, 0, 0, 0.6) 100%
		);
		transition: opacity 2s;
	}

	.vignette {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: radial-gradient(
			ellipse 75% 65% at 50% 50%,
			transparent 55%,
			rgba(0, 0, 0, 0.08) 80%,
			rgba(0, 0, 0, 0.3) 100%
		);
	}
</style>
