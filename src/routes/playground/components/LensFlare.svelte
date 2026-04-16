<script lang="ts">
/**
 * LensFlare — dynamic sun-tracking optical flare.
 *
 * Positions the flare core at the sun's screen-space coordinates (sunX, sunY).
 * A ghost ring appears mirrored through viewport center (classic lens optics —
 * internal reflections between lens elements project ghosts opposite the source).
 * A horizontal streak spans the full width at the sun's Y position.
 *
 * Intensity driven by sunAlignment (0 = sun out of view, 1 = perfectly aligned).
 */

interface Props {
	sunAlignment: number;
	skyState: string;
	sunX?: number; // % from left (50 = center)
	sunY?: number; // % from top (50 = center)
}

let { sunAlignment, skyState, sunX = 50, sunY = 35 }: Props = $props();

const opacity = $derived(sunAlignment * (skyState === 'day' ? 0.85 : 0.6));

// Ghost position — mirrored through viewport center
const ghostX = $derived(100 - sunX);
const ghostY = $derived(100 - sunY);

// Streak angle — tilts slightly based on sun's horizontal offset
const streakAngle = $derived((sunX - 50) * 0.15);
</script>

{#if sunAlignment > 0.01}
	<div class="lens-flare" style:opacity aria-hidden="true">
		<!-- Core glow — bright disc at sun position -->
		<div class="flare-core"
			style:left="{sunX}%"
			style:top="{sunY}%"
		></div>

		<!-- Warm halo around core -->
		<div class="flare-halo"
			style:left="{sunX}%"
			style:top="{sunY}%"
		></div>

		<!-- Ghost ring — mirrored through center (lens optics) -->
		<div class="flare-ghost"
			style:left="{ghostX}%"
			style:top="{ghostY}%"
			style:opacity={sunAlignment * 0.4}
		></div>

		<!-- Small secondary ghost — halfway between center and primary ghost -->
		<div class="flare-ghost-sm"
			style:left="{50 + (ghostX - 50) * 0.5}%"
			style:top="{50 + (ghostY - 50) * 0.5}%"
			style:opacity={sunAlignment * 0.25}
		></div>

		<!-- Horizontal streak — spans viewport at sun's Y level -->
		<div class="flare-streak"
			style:top="{sunY}%"
			style:transform="rotate({streakAngle}deg)"
		></div>
	</div>
{/if}

<style>
	.lens-flare {
		position: absolute;
		inset: 0;
		pointer-events: none;
		mix-blend-mode: screen;
		transition: opacity 0.3s ease-out;
		z-index: 10;
		overflow: hidden;
	}

	.flare-core {
		position: absolute;
		width: 12vw;
		height: 12vw;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		background: radial-gradient(circle,
			rgba(255,255,255,1) 0%,
			rgba(255,240,200,0.7) 15%,
			rgba(255,200,120,0.3) 40%,
			rgba(255,180,100,0) 70%
		);
		filter: blur(8px);
	}

	.flare-halo {
		position: absolute;
		width: 30vw;
		height: 30vw;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		background: radial-gradient(circle,
			rgba(255,200,120,0.12) 0%,
			rgba(255,180,100,0.05) 40%,
			rgba(255,160,80,0) 70%
		);
	}

	.flare-ghost {
		position: absolute;
		width: 8vw;
		height: 8vw;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		border: 1px solid rgba(255, 180, 100, 0.15);
		background: radial-gradient(circle,
			rgba(100, 180, 255, 0.08) 0%,
			rgba(100, 160, 255, 0.03) 50%,
			rgba(100, 140, 255, 0) 70%
		);
	}

	.flare-ghost-sm {
		position: absolute;
		width: 4vw;
		height: 4vw;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		background: radial-gradient(circle,
			rgba(180, 220, 255, 0.1) 0%,
			rgba(180, 220, 255, 0) 70%
		);
	}

	.flare-streak {
		position: absolute;
		left: 0;
		right: 0;
		height: 3px;
		transform-origin: center;
		background: linear-gradient(90deg,
			rgba(255,200,100,0) 0%,
			rgba(255,220,150,0.15) 20%,
			rgba(255,240,180,0.5) 45%,
			rgba(255,255,255,0.7) 50%,
			rgba(255,240,180,0.5) 55%,
			rgba(255,220,150,0.15) 80%,
			rgba(255,200,100,0) 100%
		);
		filter: blur(1.5px);
	}
</style>
