<script lang="ts">
	/**
	 * GlassOverlays — airplane window glass decorative layers.
	 *
	 * Ported from prod shell/window/Glass.svelte. Three pointer-events:none
	 * overlays that sit above the scene to create depth illusion:
	 *   - glass-vignette  (z:12) — radial edge darkening
	 *   - glass-recess    (z:13) — inset shadow for recessed pane feel
	 *   - wing-silhouette (z:11) — bottom-left wing shadow, tilts with bank
	 */

	interface Props {
		bankAngle?: number;
	}

	let { bankAngle = 0 }: Props = $props();
</script>

<div class="glass-vignette" aria-hidden="true"></div>
<div class="glass-recess" aria-hidden="true"></div>
<div
	class="wing-silhouette"
	style:transform="rotate({(-2 + bankAngle * 0.3).toFixed(2)}deg)"
	aria-hidden="true"
></div>

<style>
	.glass-vignette {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 12;
		background: radial-gradient(
			ellipse 80% 70% at 50% 50%,
			transparent 50%,
			rgba(0, 0, 0, 0.06) 70%,
			rgba(0, 0, 0, 0.25) 100%
		);
	}
	.glass-recess {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 13;
		border-radius: inherit;
		box-shadow:
			inset 0 0 30px 6px rgba(0, 0, 0, 0.15),
			inset 2px 2px 8px rgba(0, 0, 0, 0.1);
	}
	.wing-silhouette {
		position: absolute;
		bottom: -5%;
		left: -15%;
		width: 75%;
		height: 32%;
		pointer-events: none;
		z-index: 11;
		transform-origin: 80% 100%;
		background: linear-gradient(
			25deg,
			rgba(20, 20, 25, 0.55) 0%,
			rgba(30, 30, 35, 0.35) 20%,
			rgba(40, 40, 50, 0.15) 40%,
			transparent 60%
		);
	}
</style>
