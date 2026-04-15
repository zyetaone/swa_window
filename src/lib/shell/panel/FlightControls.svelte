<script lang="ts">
	/**
	 * FlightControls — cruising speed + altitude sliders.
	 * Slider ranges pull from config SSOT (camera.cruise + camera.altitude).
	 */
	import { useAppState } from '$lib/model/state.svelte';
	import RangeSlider from '../RangeSlider.svelte';

	const model = useAppState();
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
		oninput={(e) => model.applyPatch({ flightSpeed: parseFloat(e.currentTarget.value) })}
	/>
	<RangeSlider
		id="altitude"
		label="Altitude"
		min={model.config.camera.altitude.min}
		max={model.config.camera.altitude.max}
		step={1000}
		value={model.flight.altitude}
		formatValue={(v) => (v / 1000).toFixed(0) + 'k ft'}
		oninput={(e) => model.flight.setAltitude(parseFloat(e.currentTarget.value))}
	/>
</section>
