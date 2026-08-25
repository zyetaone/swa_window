<script lang="ts">
	/**
	 * GlassVignette — radial lens vignette gradient for the cabin window.
	 */
	interface Props {
		opacity?: number;
	}

	const { opacity = 1 }: Props = $props();
</script>

<div class="glass-vignette" style:opacity aria-hidden="true"></div>

<style>
	.glass-vignette {
		position: absolute;
		inset: 0;
		background: radial-gradient(
			ellipse at 50% 50%,
			transparent 60%,
			rgba(10, 16, 26, 0.3) 85%,
			rgba(5, 8, 14, 0.6) 100%
		);
		pointer-events: none;
	}
</style>
