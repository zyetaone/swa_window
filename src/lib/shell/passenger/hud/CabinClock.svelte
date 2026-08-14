<script lang="ts">
	/**
	 * CabinClock — glassmorphic wall clock, toggled by a single tap.
	 *
	 * ─── WHY IT EXISTS ──────────────────────────────────────────────────────
	 * Toggled by a tap on the open glass, or via LightingControls
	 * "Cabin Clock" (kiosk SidePanel Advanced + admin ambient). An office
	 * passer-by can get the time from the window without pulling out a phone.
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
	} from '$lib/shell/passenger/wall-clock.svelte';

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

		border-radius: 16px;
		/* The glass itself: a blurred sample of the live scene, and now almost
		   nothing else. The previous treatment drew a lit pane — 0.16 fill, a
		   1px edge and three shadows including two insets — which read as a
		   card sitting ON the window rather than a reflection IN it, and the
		   card is the thing competing with the view.
		   What survives is the refraction (the part that actually tracks the
		   sky as the flight moves) at roughly a third of the old fill. The
		   edge is a hairline instead of a border, the insets are gone, and the
		   one remaining drop shadow only separates the panel from a bright
		   noon sky. Legibility is carried by the type's own text-shadow, which
		   is why the fill can go this far without the digits going soft. */
		background: linear-gradient(
			160deg,
			rgba(255, 255, 255, 0.07) 0%,
			rgba(255, 255, 255, 0.025) 46%,
			rgba(120, 140, 190, 0.045) 100%
		);
		backdrop-filter: blur(16px) saturate(1.2);
		-webkit-backdrop-filter: blur(16px) saturate(1.2);
		border: 1px solid rgba(255, 255, 255, 0.10);
		box-shadow: 0 6px 22px rgba(0, 0, 0, 0.20);

		opacity: var(--night-dim);
		animation: clock-in 420ms cubic-bezier(0.22, 1, 0.36, 1);
		pointer-events: none;   /* furniture, not a control — never eat a tap */
		user-select: none;
	}

	/* performance preset: same silhouette, no blur pass.
	   THIS IS THE BRANCH THE KIOSK ACTUALLY RENDERS — qualityMode defaults to
	   'performance', so the glass above is the dev/ultra look and this flat
	   fill is what goes on the wall. Any change to the clock's weight has to
	   be made here to be real. 0.58 was a near-solid navy slab; at 0.34 it
	   reads as tinted glass while still giving the digits a ground against a
	   bright noon sky, which is the one thing a pure-transparent version
	   loses on this preset (no blur to separate type from scene). */
	.cabin-clock.flat {
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
		background: rgba(18, 22, 38, 0.34);
		border-color: rgba(255, 255, 255, 0.08);
	}

	.time {
		/* Was 'JetBrains Mono' — which is not installed on the Pi and is not
		   bundled anywhere in this repo, so the fielded kiosks have been
		   rendering DejaVu Sans Mono this whole time. The clock was never
		   actually seen as designed. Rather than ship the missing file, this
		   moves to the cabin signage stack: airline displays are set in a
		   humanist sans, not a mono, and tabular figures below give back the
		   only thing the mono was really providing. */
		font-family: var(--sw-font-cabin, system-ui, sans-serif);
		font-size: clamp(28px, 4.4vh, 46px);
		font-weight: 300;
		letter-spacing: 0.06em;
		line-height: 1;
		color: rgba(255, 255, 255, 0.93);
		/* Carries legibility against a bright noon sky now that the panel
		   behind it is nearly clear — do not soften without re-checking midday. */
		text-shadow: 0 2px 12px rgba(0, 0, 0, 0.50);
		/* Tabular figures stop the layout jittering as digits change width.
		   Load-bearing here: a proportional sans would reflow every minute. */
		font-variant-numeric: tabular-nums;
	}

	.date {
		font-family: var(--sw-font-cabin, system-ui, sans-serif);
		font-size: clamp(9px, 1.3vh, 12px);
		font-weight: 400;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: rgba(255, 255, 255, 0.58);
		text-shadow: 0 1px 6px rgba(0, 0, 0, 0.42);
	}

	@keyframes clock-in {
		from { opacity: 0; transform: translateX(-50%) translateY(-8px) scale(0.97); }
		to   { opacity: var(--night-dim); transform: translateX(-50%) translateY(0) scale(1); }
	}

	@media (prefers-reduced-motion: reduce) {
		.cabin-clock { animation: none; }
	}
</style>
