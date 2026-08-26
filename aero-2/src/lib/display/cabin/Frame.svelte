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
			transparent 55%,
			rgba(10, 16, 26, 0.25) 80%,
			rgba(5, 8, 14, 0.65) 100%
		);
	}

	/* Acrylic rim blur — mimics double-curved edge acrylic refraction */
	.glass-vignette::before {
		content: '';
		position: absolute;
		inset: 0;
		backdrop-filter: blur(2px);
		-webkit-backdrop-filter: blur(2px);
		-webkit-mask-image: radial-gradient(
			ellipse 84% 78% at 50% 50%,
			transparent 65%,
			rgba(0, 0, 0, 0.6) 85%,
			#000 100%
		);
		mask-image: radial-gradient(
			ellipse 84% 78% at 50% 50%,
			transparent 65%,
			rgba(0, 0, 0, 0.6) 85%,
			#000 100%
		);
	}

	.glass-reflection {
		position: absolute;
		top: -25%;
		right: -15%;
		width: 70%;
		height: 150%;
		background: linear-gradient(
			135deg,
			rgba(255, 255, 255, 0.04) 0%,
			rgba(255, 255, 255, 0.015) 30%,
			transparent 55%
		);
		transform: rotate(-15deg);
	}

	.window-bezel {
		position: absolute;
		inset: 0;
		box-shadow:
			inset 0 0 80px 40px rgba(0, 0, 0, 0.85),
			inset 0 0 12px 2px rgba(255, 255, 255, 0.05);
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
