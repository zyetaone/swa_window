<script lang="ts">
	/**
	 * BootLockup — the held first frame.
	 *
	 * Identical artwork to the Plymouth boot theme and the X root window, so
	 * power-on through to a live window reads as ONE still frame that dissolves
	 * into motion, rather than three pictures in a row. If you restyle this,
	 * re-export deploy/pi/branding/aero-splash.png from the same markup or the
	 * handoff will visibly step.
	 *
	 * Held until the scene actually renders — `measuredFps > 0` is the first
	 * honest proof a frame reached the panel, so there is no black gap and no
	 * half-drawn globe on show.
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';

	const model = useAeroWindow();

	// Live once the renderer reports real frames. Deliberately NOT latched:
	// if rendering stalls, covering the view is the correct behaviour — it is
	// the same contract as the blind in liveness.ts, where the audience sees
	// the splash rather than a frozen or half-drawn globe while the watchdog
	// reloads underneath.
	const isLive = $derived(model.measuredFps > 0);
</script>

<div class={['boot-lockup', isLive && 'dissolved']} aria-hidden={isLive}>
	<div class="lockup">
		<div class="wordmark">
			<span class="word">Aero</span>
			<span class="word">Window</span>
		</div>
		<div class="rule-row">
			<span class="hair"></span>
			<span class="partners">
				<span class="partner">Zyeta</span>
				<span class="cross">×</span>
				<span class="partner">SWA</span>
			</span>
			<span class="hair right"></span>
		</div>
	</div>
</div>

<style>
	.boot-lockup {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: grid;
		place-items: center;
		background: #000;
		/* The atmosphere the globe blooms into — already present under the
		   lockup, so the dissolve reveals depth rather than a flat cut. */
		background-image: radial-gradient(
			ellipse 120% 60% at 50% 118%,
			rgba(48, 76, 178, 0.3) 0%,
			transparent 62%
		);
		opacity: 1;
		transition: opacity 900ms ease;
		pointer-events: none;
	}

	.boot-lockup.dissolved {
		opacity: 0;
	}

	.lockup {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4.6vw;
		width: 62vw;
		text-align: center;
	}

	/* Two deliberate lines, not a wrap — the break is part of the mark, so it
	   stays put at any panel width instead of reflowing. */
	.wordmark {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5vw;
	}

	.word {
		font-family: Ubuntu, 'Ubuntu Sans', system-ui, sans-serif;
		font-weight: 300;
		font-size: 6.2vw;
		white-space: nowrap;
		line-height: 1;
		letter-spacing: 0.34em;
		text-transform: uppercase;
		/* Optical centring — the trailing letter-space would otherwise push
		   the whole word left of true centre. */
		text-indent: 0.34em;
		color: var(--sw-silver, #cccccc);
	}

	.rule-row {
		display: flex;
		align-items: center;
		gap: 3.4vw;
		width: 100%;
	}

	.hair {
		flex: 1;
		height: 1px;
		background: linear-gradient(90deg, transparent, rgba(204, 204, 204, 0.42));
	}

	.hair.right {
		background: linear-gradient(270deg, transparent, rgba(204, 204, 204, 0.42));
	}

	.partners {
		display: flex;
		align-items: center;
		gap: 2.2vw;
		font-size: 1.85vw;
	}

	.partner {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-weight: 400;
		line-height: 1;
		letter-spacing: 0.3em;
		text-transform: uppercase;
		text-indent: 0.3em;
		color: #7e8496;
	}

	.cross {
		font-family: Ubuntu, 'Ubuntu Sans', system-ui, sans-serif;
		font-weight: 300;
		color: var(--sw-blue, #304cb2);
	}

	@media (prefers-reduced-motion: reduce) {
		.boot-lockup {
			transition: none;
		}
	}
</style>
