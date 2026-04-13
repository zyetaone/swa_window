<script lang="ts">
	/**
	 * Weather - Pure presentational layer for rain, lightning, and frost effects.
	 *
	 * Z-order (inline styles, set by parent):
	 *   2: Rain streaks
	 *   2: Lightning flash
	 *   5: Frost overlay
	 */

	interface Props {
		rainOpacity: number;
		windAngle: number;
		lightningOpacity: number;
		lightningX: number;
		lightningY: number;
		frostAmount: number;
	}

	let {
		rainOpacity,
		windAngle,
		lightningOpacity,
		lightningX,
		lightningY,
		frostAmount,
	}: Props = $props();
</script>

<!-- Rain streaks -->
{#if rainOpacity > 0}
	<div
		class="rain-layer"
		style:z-index={2}
		style:opacity={rainOpacity}
		style:--angle="{windAngle}deg"
	>
		<div class="rain-near"></div>
		<div class="rain-far"></div>
	</div>
{/if}

<!-- Positional lightning flash -->
{#if lightningOpacity > 0}
	<div
		class="lightning-flash"
		style:z-index={2}
		style:opacity={lightningOpacity}
		style:--lx="{lightningX}%"
		style:--ly="{lightningY}%"
	></div>
{/if}

<!-- Frost at high altitude -->
{#if frostAmount > 0}
	<div
		class="frost-layer"
		style:z-index={5}
		style:opacity={frostAmount * 0.3}
	></div>
{/if}

<style>
	/* --- Weather: Rain --- */

	.rain-layer {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
		transition: opacity 1s ease;
	}

	.rain-near,
	.rain-far {
		position: absolute;
		inset: -50%;
		background: repeating-linear-gradient(
			var(--angle),
			transparent 0px,
			transparent 4px,
			rgba(180, 200, 255, 0.3) 4px,
			rgba(180, 200, 255, 0.3) 5px
		);
	}

	.rain-near {
		background-size: 100% 80px;
		animation: rain-fall 0.4s linear infinite;
	}

	.rain-far {
		background-size: 100% 50px;
		opacity: 0.5;
		animation: rain-fall 0.6s linear infinite;
	}

	@keyframes rain-fall {
		from {
			transform: translate3d(0, -80px, 0);
		}
		to {
			transform: translate3d(0, 0, 0);
		}
	}

	/* --- Weather: Lightning --- */

	.lightning-flash {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: radial-gradient(
			ellipse 60% 50% at var(--lx) var(--ly),
			rgba(200, 200, 255, 1) 0%,
			rgba(180, 180, 255, 0.6) 30%,
			rgba(150, 150, 230, 0.2) 60%,
			transparent 85%
		);
		mix-blend-mode: screen;
		transition: opacity 0.05s linear;
	}

	/* --- Effect: Frost --- */

	.frost-layer {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: radial-gradient(
			ellipse 100% 100% at 50% 50%,
			transparent 40%,
			rgba(200, 220, 255, 0.4) 70%,
			rgba(180, 200, 255, 0.6) 90%
		);
		animation: frost-breathe 8s ease-in-out infinite alternate;
	}

	@keyframes frost-breathe {
		from {
			opacity: 0.8;
		}
		to {
			opacity: 1;
		}
	}
</style>
