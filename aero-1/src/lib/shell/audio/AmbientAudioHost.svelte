<script lang="ts">
	/**
	 * Drives the synthesized cabin ambience from live scene state.
	 *
	 * Renders nothing. Deliberately takes plain props rather than reaching into
	 * the AeroWindow context: that keeps the audio graph drivable from the lab
	 * route, a test, or a future preview surface without any of them having to
	 * construct a model.
	 *
	 * The `enabled` default is false (see config-tree), so on a stock kiosk this
	 * component allocates nothing at all — `apply()` returns before touching the
	 * Web Audio API.
	 */
	import { onDestroy } from 'svelte';
	import { AmbientAudio } from './ambient-audio';
	import { config } from '$lib/model/config-tree.svelte';
	import { WEATHER_EFFECTS } from '$content/weather';
	import type { WeatherType } from '$lib/types';

	const { altitudeFt, weather, isLeader }: {
		altitudeFt: number;
		weather: WeatherType;
		isLeader: boolean;
	} = $props();

	const audio = new AmbientAudio();

	// Weather rides the same recipe the visuals do, rather than a second
	// hand-maintained mapping that could drift from the rain on the glass.
	//
	// Normalised against the WETTEST recipe rather than used raw: rainOpacity
	// is an alpha for a CSS layer and tops out at 0.35, so feeding it straight
	// in meant the weather fader could never exceed 35% however far the
	// operator pushed it. Derived from the recipes so adding a wetter one
	// re-scales the range instead of silently pinning the top of it.
	const MAX_RAIN = Math.max(
		...Object.values(WEATHER_EFFECTS).map((fx) => fx.rainOpacity),
		0.0001, // never divide by zero if every recipe goes dry
	);
	const wet = $derived(
		Math.min(1, (WEATHER_EFFECTS[weather]?.rainOpacity ?? 0) / MAX_RAIN),
	);

	// ─── Why altitude is quantized ──────────────────────────────────────────
	// flight.altitude is lerped EVERY FRAME by #tickAltitude, so reading it
	// raw made this effect re-run at 60 Hz — re-scheduling four Web Audio
	// params and allocating a play() promise per frame, on a Pi, forever.
	//
	// 500 ft is well under the ~110 Hz of cutoff travel spread across the
	// altitude range, so banding is inaudible, but it collapses the update
	// rate from 60/s to roughly one per several seconds of drift.
	const altitudeBand = $derived(Math.round(altitudeFt / 500) * 500);

	$effect(() => {
		audio.apply(
			{
				enabled: config.audio.enabled,
				masterVolume: config.audio.masterVolume,
				engineVolume: config.audio.engineVolume,
				weatherVolume: config.audio.weatherVolume,
				musicVolume: config.audio.musicVolume,
				musicUrl: config.audio.musicUrl,
			},
			{ altitudeFt: altitudeBand, wet, musicAllowed: isLeader },
		);
	});

	// Browsers hold the context suspended until a gesture. The kiosk ships
	// --autoplay-policy=no-user-gesture-required so this only matters in dev and
	// on the admin iPad; harmless either way, and removed after it fires once.
	function unlock(): void {
		audio.resume();
	}

	onDestroy(() => audio.dispose());
</script>

<svelte:window onpointerdown={unlock} ontouchstart={unlock} />
