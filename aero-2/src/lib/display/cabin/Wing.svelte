<script lang="ts">
	/**
	 * Wing — aircraft wing silhouette looking out the passenger window.
	 * Positioned in lower quadrant with smooth lighting gradient and navigation light.
	 */
	import { useDisplay } from '../display.svelte.js';

	interface Props {
		visible?: boolean;
	}

	let { visible = true }: Props = $props();

	const display = useDisplay();

	/**
	 * Roll the wing with the aircraft.
	 *
	 * A real aircraft banks INTO its turn, so the inside wing drops — whichever
	 * way round the loop is flown. Seen from a window seat that reads as the wing
	 * dipping toward the ground on the turn in, and rising toward the sky as the
	 * turn unwinds.
	 *
	 * Damped to a fraction of the airframe's roll: the window frame is fixed to
	 * the same fuselage, so a passenger sees far less relative movement than the
	 * bank angle suggests. Full roll here would look like the wing was detached.
	 */
	const roll = $derived((display.view.bankDeg ?? 0) * 0.55);
</script>

{#if visible}
	<div class="cabin-wing" style:rotate="{roll}deg" aria-hidden="true">
		<!-- Wing profile geometry -->
		<svg class="wing-svg" viewBox="0 0 1000 600" preserveAspectRatio="none">
			<defs>
				<linearGradient id="wingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
					<stop offset="0%" stop-color="#334155" stop-opacity="0.95" />
					<stop offset="60%" stop-color="#1e293b" stop-opacity="0.98" />
					<stop offset="100%" stop-color="#0f172a" stop-opacity="1" />
				</linearGradient>
				<linearGradient id="edgeHighlight" x1="0%" y1="0%" x2="100%" y2="0%">
					<stop offset="0%" stop-color="#ffffff" stop-opacity="0.3" />
					<stop offset="100%" stop-color="#ffffff" stop-opacity="0.05" />
				</linearGradient>
			</defs>

			<!-- Wing body -->
			<path
				d="M 1000,380 L 320,520 Q 260,535 240,560 L 220,600 L 1000,600 Z"
				fill="url(#wingGrad)"
			/>
			<!-- Leading edge highlight -->
			<path
				d="M 1000,380 L 320,520 Q 260,535 240,560"
				fill="none"
				stroke="url(#edgeHighlight)"
				stroke-width="3"
			/>
			<!-- Wingtip strobe / navigation light -->
			<circle cx="250" cy="545" r="4" fill="#38bdf8" class="strobe" />
		</svg>
	</div>
{/if}

<style>
	.cabin-wing {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
		z-index: 5;
		/* Pivot at the wing root (off-screen right, where it meets the
		   fuselage), not the middle of the layer — a centre pivot makes the
		   wing tip swing the wrong way. */
		transform-origin: 100% 65%;
		will-change: rotate;
	}

	.wing-svg {
		position: absolute;
		bottom: 0;
		right: 0;
		width: 65%;
		height: 45%;
	}

	.strobe {
		animation: strobe-pulse 2s infinite ease-in-out;
	}

	@keyframes strobe-pulse {
		0%,
		90%,
		100% {
			opacity: 0.2;
			transform-origin: 250px 545px;
			transform: scale(1);
		}
		93% {
			opacity: 1;
			transform-origin: 250px 545px;
			transform: scale(1.8);
		}
		96% {
			opacity: 0.3;
			transform-origin: 250px 545px;
			transform: scale(1);
		}
		98% {
			opacity: 1;
			transform-origin: 250px 545px;
			transform: scale(1.8);
		}
	}
</style>
