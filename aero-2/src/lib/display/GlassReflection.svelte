<script lang="ts">
	/**
	 * GlassReflection — angled glossy glass reflection streak.
	 */
	interface Props {
		opacity?: number;
	}

	const { opacity = 1 }: Props = $props();
</script>

<div class="glass-reflection" style:opacity aria-hidden="true"></div>

<style>
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
