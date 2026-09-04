<script lang="ts">
	/**
	 * Display — Top-level parent feature component for the kiosk window display.
	 * Composes the outside 3D world (Stage), aircraft wing silhouette (Wing),
	 * inside cabin chrome (Frame), minimap (MiniMap), and telemetry status band (Hud).
	 *
	 * Uses Svelte 5 <svelte:boundary> to isolate 3D WebGL runtime errors from taking
	 * down the cabin frame or operator UI.
	 */
	// './world/Stage.svelte', NOT './world/maplibre/Stage.svelte'. The latter
	// exists only in another session's uncommitted working tree, and an earlier
	// commit here picked the line up mid-edit -- so main pointed at a directory
	// git has never seen and a clean clone could not build.
	import Stage from './world/Stage.svelte';
	import Clouds from './world/Clouds.svelte';
	import Wing from './cabin/Wing.svelte';
	import Frame from './cabin/Frame.svelte';
	import Blind from './cabin/Blind.svelte';
	import RainGlass from './cabin/RainGlass.svelte';
	import Hud from './cabin/Hud.svelte';
	import MiniMap from './flight/MiniMap.svelte';
	import MediaStage from './media/MediaStage.svelte';
	import AudioHost from './media/AudioHost.svelte';
	import { useDisplay } from './display.svelte.js';
	import type { Snippet } from 'svelte';
	import { createWallPoller } from '#lib/settings/wall-poll.js';
	import { PUBLIC_WALL_ORIGIN } from '$app/env/public';

	/**
	 * `hud` is the only switch here, because it is the only one with a caller.
	 *
	 * There used to be five -- clouds, wing, minimap, blind -- and +page.svelte
	 * passed exactly one of them. Three of the other four duplicated a config
	 * knob the child already reads (`Clouds` gates on `config.clouds`, `Wing` on
	 * `config.wing`, `Blind` on `config.blindOpen`), so the same light had two
	 * switches and only one of them was wired to anything.
	 */
	interface Props {
		hud?: boolean;
		children?: Snippet;
	}

	let { hud = true, children }: Props = $props();

	const display = useDisplay();

	function onStageError(error: unknown) {
		console.error('[AeroDisplay] 3D World Stage error caught by boundary:', error);
	}

	/**
	 * The watchdog: a frozen window looks exactly like a working one.
	 *
	 * `<svelte:boundary>` catches a THROW. It cannot see a stall — a render loop
	 * that stops being called leaves a live canvas holding its last frame, at a
	 * plausible altitude, with a clean console. On a wall in Hyderabad that is a
	 * photograph of an aeroplane window, indistinguishable from the product.
	 *
	 * TWO failures, not one, and the first version of this only caught the
	 * second. A loop that never STARTS looks identical to one that stops: the
	 * pose is whatever the constructor computed, the HUD reads the constructor's
	 * 60 FPS / 16.6 ms defaults, four canvases are mounted, nothing throws. That
	 * state was reproduced here on a clean load — two readings six seconds apart,
	 * byte-identical — and the watchdog called it healthy, because it only
	 * measured elapsed time once a first frame had arrived.
	 *
	 * `view.wallSec` is the timestamp of the last pose the loop derived, so the
	 * gap between it and the real clock IS the stall. Before the first frame
	 * there is no such gap to measure, so the clock starts at mount instead.
	 */
	const STALL_SEC = 12;
	/** A loop that has not drawn once by here is not slow, it is broken. */
	const BOOT_SEC = 30;
	/** Long enough that a slow tile load or a GC pause cannot trigger a reload. */
	const RELOAD_SEC = 60;

	const mountedAtSec = Date.now() / 1000;

	/**
	 * The one legitimate second clock in the display.
	 *
	 * Three private clocks were deleted from this codebase for splitting the
	 * fleet, so this needs saying: a watchdog sharing the frame loop's clock
	 * could not detect the frame loop stopping. Independence is the mechanism,
	 * not an oversight — and it is pane-local by nature, observing this process
	 * rather than deriving anything three panes must agree on.
	 */
	let probe = $state({ started: false, lastFrameSec: 0, nowSec: mountedAtSec });

	$effect(() => {
		const id = setInterval(() => {
			probe = {
				started: display.hasAdvanced,
				lastFrameSec: display.view.wallSec,
				nowSec: Date.now() / 1000
			};
		}, 1000);
		return () => clearInterval(id);
	});

	/** Seconds of stillness — since the last frame, or since mount if there was none. */
	const frozenSec = $derived(
		Math.max(0, probe.nowSec - (probe.started ? probe.lastFrameSec : mountedAtSec))
	);
	const stalled = $derived(frozenSec > (probe.started ? STALL_SEC : BOOT_SEC));

	/**
	 * Unattended recovery, because nobody is looking at this screen.
	 *
	 * There is no fleet layer yet: no heartbeat, no operator alert, no console
	 * anyone reads, so detection alone would change nothing on the wall. A
	 * reload is crude and that is the point — if it reloads and stalls again it
	 * keeps reloading, which is at least visibly broken rather than invisibly
	 * frozen.
	 *
	 * Production only. `vite dev` serves maplibre unbundled, so a cold start can
	 * legitimately take longer than BOOT_SEC, and a development machine that
	 * reloads itself every minute is not a development machine. The banner still
	 * shows in dev — the diagnosis is useful there, the reboot is not.
	 */
	$effect(() => {
		if (stalled && frozenSec > RELOAD_SEC && import.meta.env.PROD) location.reload();
	});

	/**
	 * Poll the shared wall state.
	 *
	 * Here rather than in Stage, because the buffer belongs to the display and
	 * outlives any one renderer — Stage remounts on a WebGL context loss and a
	 * poll that remounted with it would drop the pending snapshot.
	 *
	 * It only fills `display.wall`; `advanceTo` is what applies it, at the second
	 * the snapshot names. An empty PUBLIC_WALL_ORIGIN means this pane polls
	 * itself, which is the correct single-pane behaviour.
	 */
	$effect(() => {
		const poller = createWallPoller(display.wall, PUBLIC_WALL_ORIGIN);
		// First poll now rather than one interval from now: a pane that just booted
		// should pick up a wall that was set before it did.
		void poller.poll();
		return () => poller.stop();
	});
</script>

<div class="aero-display">
	<!-- 3D World protected by Svelte 5 Error Boundary -->
	<svelte:boundary onerror={onStageError}>
		<Stage />

		<!-- Inside the boundary, like the rest of the 3D world: Clouds runs its
		     own WebGL context and can lose it exactly the way Stage can. It sat
		     outside, so a Three.js context loss took down the whole page while
		     the identical failure in MapLibre was caught and offered a retry. -->
		<Clouds />

		{#if stalled}
			<div class="stage-error-fallback">
				<div class="glass-panel error-card">
					<h3>Display Signal Lost</h3>
					<p>
						{probe.started
							? `The window stopped drawing ${Math.round(frozenSec)}s ago.`
							: `The window has not drawn a frame in ${Math.round(frozenSec)}s.`}
					</p>
					<button type="button" class="glass-btn" onclick={() => location.reload()}>
						Reload
					</button>
				</div>
			</div>
		{/if}

		{#snippet failed(error, reset)}
			<div class="stage-error-fallback">
				<div class="glass-panel error-card">
					<h3>Display Signal Lost</h3>
					<p>{error instanceof Error ? error.message : 'WebGL rendering error'}</p>
					<button type="button" class="glass-btn" onclick={reset}>Re-initialize Stage</button>
				</div>
			</div>
		{/snippet}
	</svelte:boundary>

	<Wing />
	<RainGlass />
	<Frame />
	<Blind />
	<MiniMap />
	<!-- `visible`, not `{#if}`: Hud owns the `--hud-height` CSS variable the
	     rest of the cabin lays out against, and unmounting it left that variable
	     stale at the ribbon height with no ribbon under it. -->
	<Hud visible={hud} />
	<MediaStage />
	<AudioHost />
	{@render children?.()}
</div>

<style>
	.aero-display {
		position: fixed;
		inset: 0;
		background: #000;
		overflow: hidden;
		user-select: none;
	}
	.stage-error-fallback {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #05080e;
		z-index: 1;
	}
	.error-card {
		padding: 24px;
		text-align: center;
		max-width: 360px;
	}
	.error-card h3 {
		margin: 0 0 8px 0;
		color: #f87171;
	}
	.error-card p {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin-bottom: 16px;
	}
</style>
