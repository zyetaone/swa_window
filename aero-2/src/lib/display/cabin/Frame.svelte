<script lang="ts">
	/**
	 * CabinFrame — oval airplane cabin window frame with integrated glass
	 * reflections, lens vignette, and inner depth shadows.
	 */
	interface Props {
		visible?: boolean;
		vignette?: boolean;
		reflection?: boolean;
		bezel?: boolean;
	}

	const { visible = true, vignette = true, reflection = true, bezel = true }: Props = $props();
</script>

{#if visible}
	<div class="cabin-frame" aria-hidden="true">
		{#if vignette}
			<div class="glass-vignette"></div>
		{/if}
		{#if reflection}
			<div class="glass-reflection"></div>
		{/if}
		{#if bezel}
			<div class="window-bezel">
				<div class="bezel-inner"></div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.cabin-frame {
		position: fixed;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
		user-select: none;
		z-index: 10;
	}

	.glass-vignette {
		position: absolute;
		inset: 0;
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
	}

	.window-bezel {
		position: absolute;
		inset: 0;
		box-shadow: inset 0 0 80px 40px rgba(0, 0, 0, 0.85);
	}

	.bezel-inner {
		position: absolute;
		inset: 12px;
		border-radius: 42px;
		border: 1.5px solid rgba(255, 255, 255, 0.08);
		box-shadow:
			inset 0 0 30px rgba(0, 0, 0, 0.6),
			0 0 0 12px rgba(18, 22, 28, 0.95);
	}
</style>
