<script lang="ts">
	/**
	 * FlightControls — cruising speed + altitude sliders.
	 * Slider ranges pull from config SSOT (camera.cruise + camera.altitude).
	 */
	import { config } from '$lib/model/config-tree.svelte';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import RangeSlider from './RangeSlider.svelte';
	import Toggle from './Toggle.svelte';

	const model = useAeroWindow();
</script>

<section>
	<h4>Flight</h4>
	<RangeSlider
		id="speed"
		label="Cruising Speed"
		min={model.config.camera.cruise.minSpeed}
		max={model.config.camera.cruise.maxSpeed}
		step={0.1}
		value={model.flight.flightSpeed}
		formatValue={(v) => v.toFixed(1) + 'x'}
		oninput={(e) => model.setFlightSpeed(parseFloat(e.currentTarget.value))}
	/>
	<RangeSlider
		id="altitude"
		label="Altitude"
		min={model.config.camera.altitude.min}
		max={model.config.camera.altitude.max}
		step={1000}
		value={model.flight.altitude}
		formatValue={(v) => (v / 1000).toFixed(0) + 'k ft'}
		oninput={(e) => model.setAltitude(parseFloat(e.currentTarget.value))}
	/>
	<!-- Restrict autopilot's location pool to lit cities. ON for kiosk
	     installs so the camera never wanders to ocean / desert / mountain
	     and dimmed the scene. OFF lets the director use the full pool. -->
	<Toggle label="Night-Lit Cities Only" bind:checked={config.director.autopilot.nightLitCitiesOnly} />
</section>
