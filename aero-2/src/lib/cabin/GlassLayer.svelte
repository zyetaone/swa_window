<script lang="ts">
	/**
	 * GlassLayer — subtle airplane window glass reflections, tint, and vignette.
	 */
	interface Props {
		vignette?: boolean;
	}

	const { vignette = true }: Props = $props();
</script>

<div class="glass-layer" class:vignette aria-hidden="true">
	<div class="glass-reflection"></div>
</div>

<style>
	.glass-layer {
		position: fixed;
		inset: 0;
		pointer-events: none;
		z-index: 10;
	}

	.glass-layer.vignette {
		background: radial-gradient(
			ellipse at 50% 50%,
			transparent 60%,
			rgba(10, 16, 26, 0.3) 85%,
			rgba(5, 8, 14, 0.6) 100%
		);
	}

	.glass-reflection {
		position: absolute;
		top: -20%;
		right: -10%;
		width: 60%;
		height: 140%;
		background: linear-gradient(
			135deg,
			rgba(255, 255, 255, 0.03) 0%,
			rgba(255, 255, 255, 0.01) 40%,
			transparent 60%
		);
		transform: rotate(-15deg);
		pointer-events: none;
	}
</style>
