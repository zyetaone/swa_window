<script lang="ts">
	/**
	 * FlightControls — cruising speed + altitude (kiosk sim) + director gate.
	 * Slider ranges pull from config SSOT (camera.cruise + camera.altitude).
	 *
	 * Speed/altitude need AeroWindow (live flight state). The night-lit
	 * cities toggle is pure config via usePanelConfig — works in both
	 * kiosk SidePanel and /admin if composed there.
	 *
	 * When the wall is on video/slideshow, exposes "Return to Flight" so
	 * an on-device operator can exit media without admin. Edge panes without
	 * the SidePanel use Escape (handled on +page).
	 */
	import { usePanelConfig } from './patch';
	import { tryUseAeroWindow } from '$lib/model/aero-window.svelte';
	import { formatAltitudeFt, formatSpeedX } from '$lib/utils';
	import RangeSlider from './RangeSlider.svelte';
	import Toggle from './Toggle.svelte';

	const model = tryUseAeroWindow();
	const { cfg, patch } = usePanelConfig();
	const onMedia = $derived(model != null && model.displayMode !== 'flight');
</script>

<section>
	<h4>Flight</h4>
	{#if model && onMedia}
		<button type="button" class="return-flight" onclick={() => model.setDisplayMode('flight')}>
			Return to Flight
		</button>
		<p class="media-note">
			Wall is in {model.displayMode === 'video' ? 'video' : 'slideshow'} mode
			(full-bleed). Globe is parked warm — return is instant.
		</p>
	{:else if model}
		<RangeSlider
			id="speed"
			label="Cruising Speed"
			min={model.config.camera.cruise.minSpeed}
			max={model.config.camera.cruise.maxSpeed}
			step={0.1}
			value={model.flight.flightSpeed}
			formatValue={formatSpeedX}
			oninput={(e) => model.setFlightSpeed(parseFloat(e.currentTarget.value))}
		/>
		<RangeSlider
			id="altitude"
			label="Altitude"
			min={model.config.camera.altitude.min}
			max={model.config.camera.altitude.max}
			step={1000}
			value={model.flight.altitude}
			formatValue={formatAltitudeFt}
			oninput={(e) => model.setAltitude(parseFloat(e.currentTarget.value))}
		/>
	{/if}
	<!-- Restrict autopilot's location pool to lit cities. ON for kiosk
	     installs so the camera never wanders to ocean / desert / mountain
	     and dimmed the scene. OFF lets the director use the full pool. -->
	<Toggle label="Night-Lit Cities Only" checked={cfg.director.autopilot.nightLitCitiesOnly} onchange={(e) => patch('director.autopilot.nightLitCitiesOnly', e.currentTarget.checked)} />
</section>

<style>
	.return-flight {
		width: 100%;
		padding: 0.55rem 0.75rem;
		margin-bottom: 0.5rem;
		border-radius: 6px;
		border: 1px solid rgba(127, 174, 255, 0.4);
		background: rgba(127, 174, 255, 0.18);
		color: #e8f0ff;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}
	.return-flight:hover {
		background: rgba(127, 174, 255, 0.28);
	}
	.media-note {
		margin: 0 0 0.65rem;
		font-size: 0.7rem;
		opacity: 0.7;
		line-height: 1.35;
	}
</style>
