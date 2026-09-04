<script lang="ts">
	/**
	 * CabinFrame — oval airplane cabin window frame with integrated glass
	 * reflections, lens vignette, and inner depth shadows.
	 *
	 * It had four boolean props — visible, vignette, reflection, bezel — and its
	 * one caller passed none of them, so all four were speculative config for a
	 * value that never changed. The repo's rule is that a component's visibility
	 * is gated by the config knob it reads itself; there is no frame knob, so
	 * there is nothing to read and nothing to switch.
	 */
	import { useDisplay } from '../display.svelte.js';

	const display = useDisplay();

	/**
	 * The rim darkens as the light goes.
	 *
	 * Real cabin glass does not have a fixed vignette: at altitude in daylight
	 * the rim is barely there, and after dusk the curved acrylic edge goes to
	 * near black. Held as a registered custom property (see `@property` below)
	 * rather than an inline opacity so the CSS transition can interpolate it —
	 * an unregistered variable is a string to the cascade, and the rim would
	 * step between sky states instead of fading.
	 */
	const vignetteStrength = $derived(0.55 + display.night * 0.45);
</script>

<div class="cabin-frame" style:--vignette-strength={vignetteStrength} aria-hidden="true">
	<div class="glass-vignette"></div>
	<div class="glass-reflection"></div>
	<div class="window-bezel">
		<div class="bezel-inner"></div>
	</div>
</div>

<style>
	/* Registered, so `transition` can interpolate it. Without this the browser
	   treats the value as an opaque string and the rim snaps between states. */
	@property --vignette-strength {
		syntax: '<number>';
		initial-value: 1;
		inherits: true;
	}

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
			rgba(10, 16, 26, calc(0.25 * var(--vignette-strength))) 80%,
			rgba(5, 8, 14, calc(0.65 * var(--vignette-strength))) 100%
		);
		/* Slow on purpose: dusk takes minutes, and a rim that visibly chases the
		   sun reads as a bug rather than as glass. */
		transition: --vignette-strength 1.2s linear;
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
		border: 1.5px solid var(--glass-border-subtle);
		box-shadow:
			inset 0 0 30px rgba(0, 0, 0, 0.6),
			0 0 0 12px rgba(18, 22, 28, 0.95);
	}
</style>
