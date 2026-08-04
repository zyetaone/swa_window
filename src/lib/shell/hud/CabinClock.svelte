<script lang="ts">
	/**
	 * CabinClock — glassmorphic wall clock, toggled by double-tap.
	 *
	 * ─── WHY IT EXISTS ──────────────────────────────────────────────────────
	 * `shell.clockVisible` has existed in the config tree (and had a "Show
	 * clock" toggle in LabControls) but NOTHING rendered it — flipping that
	 * switch did nothing at all. This is the missing renderer, promoted from a
	 * lab-only idea to real cabin furniture: an office passer-by should be able
	 * to get the time from the window without pulling out a phone.
	 *
	 * ─── GLASS, ON A PI 5 BUDGET ────────────────────────────────────────────
	 * `backdrop-filter` is the honest way to do glassmorphism — it refracts the
	 * LIVE scene behind the panel, so the clock picks up the sky's colour as the
	 * flight moves. It is also GPU-costly (see RainGlass, which caps itself at
	 * ~14 beads for this reason). Three things keep the cost bounded:
	 *   • ONE small element, not a field.
	 *   • Mounted only while visible (`{#if}` in the parent), so a hidden clock
	 *     costs literally nothing — no blur pass, no timer.
	 *   • In `performance` quality mode the blur is dropped for a flat
	 *     translucent fill. On the Pi the panel is already fps-bound; a legible
	 *     clock matters more than a refraction the viewer never consciously
	 *     notices.
	 *
	 * Time comes from the shared `wall-clock` module, so this and the blind
	 * info-card can never disagree about what minute it is.
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import {
		subscribeWallClock,
		wallClockNow,
		formatClock,
		formatClockDate,
	} from '$lib/shell/wall-clock.svelte';

	const model = useAeroWindow();

	// Reference-counted: starts the shared 1 s tick on mount, releases on
	// unmount. Because the component only mounts while visible, a hidden clock
	// leaves no interval running.
	$effect(() => subscribeWallClock());

	const time = $derived(formatClock(wallClockNow()));
	const date = $derived(formatClockDate(wallClockNow()));

	// Deep night wants a dimmer face — a bright white slab at 2 AM in a dark
	// office is the one thing guaranteed to look wrong on a wall.
	const nightDim = $derived(1 - model.nightFactor * 0.35);
	// Drop the blur pass on the Pi's performance preset (see header).
	const useBlur = $derived(model.config.world.qualityMode !== 'performance');
</script>

<div
	class="cabin-clock"
	class:flat={!useBlur}
	style:--night-dim={nightDim}
	role="status"
	aria-live="polite"
	aria-label="Current time {time}"
>
	<span class="time">{time}</span>
	<span class="date">{date}</span>
</div>

<style>
	.cabin-clock {
		position: absolute;
		top: 6%;
		left: 50%;
		transform: translateX(-50%);
		z-index: 12;

		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 14px 26px 12px;

		border-radius: 18px;
		/* The glass itself: a translucent fill over a blurred, slightly
		   brightened sample of the scene behind, with a light top edge and a
		   dark bottom edge so it reads as a physical pane catching light. */
		background: linear-gradient(
			160deg,
			rgba(255, 255, 255, 0.16) 0%,
			rgba(255, 255, 255, 0.06) 46%,
			rgba(120, 140, 190, 0.10) 100%
		);
		backdrop-filter: blur(14px) saturate(1.25) brightness(1.06);
		-webkit-backdrop-filter: blur(14px) saturate(1.25) brightness(1.06);
		border: 1px solid rgba(255, 255, 255, 0.22);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.34),
			inset 0 -1px 0 rgba(0, 0, 0, 0.16),
			0 8px 26px rgba(0, 0, 0, 0.28);

		opacity: var(--night-dim);
		animation: clock-in 420ms cubic-bezier(0.22, 1, 0.36, 1);
		pointer-events: none;   /* furniture, not a control — never eat a tap */
		user-select: none;
	}

	/* performance preset: same silhouette, no blur pass. */
	.cabin-clock.flat {
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
		background: rgba(18, 22, 38, 0.58);
	}

	.time {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: clamp(28px, 4.4vh, 46px);
		font-weight: 500;
		letter-spacing: 0.04em;
		line-height: 1;
		color: rgba(255, 255, 255, 0.96);
		/* Keeps the digits legible against a bright noon sky as well as night. */
		text-shadow: 0 2px 10px rgba(0, 0, 0, 0.42);
		/* Tabular figures stop the layout jittering as digits change width. */
		font-variant-numeric: tabular-nums;
	}

	.date {
		font-size: clamp(9px, 1.3vh, 12px);
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: rgba(255, 255, 255, 0.68);
		text-shadow: 0 1px 6px rgba(0, 0, 0, 0.38);
	}

	@keyframes clock-in {
		from { opacity: 0; transform: translateX(-50%) translateY(-8px) scale(0.97); }
		to   { opacity: var(--night-dim); transform: translateX(-50%) translateY(0) scale(1); }
	}

	@media (prefers-reduced-motion: reduce) {
		.cabin-clock { animation: none; }
	}
</style>
