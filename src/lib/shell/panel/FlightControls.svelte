<script lang="ts">
	/**
	 * FlightControls — cruising speed + altitude sliders.
	 * Slider ranges pull from config SSOT (camera.cruise + camera.altitude).
	 *
	 * Routes operator writes through applyConfigPatch — see
	 * docs/ARCHITECTURE.md non-goals: `applyConfigPatch` is the single
	 * write gate for the CRDT LWW merge and the prototype-pollution
	 * defense. Direct `config.X = v` skips the gate and silently
	 * breaks fleet sync.
	 */
	import { usePanelConfig } from './patch';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { formatAltitudeFt, formatSpeedX } from '$lib/utils';
	import RangeSlider from './RangeSlider.svelte';
	import Toggle from './Toggle.svelte';

	const model = useAeroWindow();
	const { cfg, patch } = usePanelConfig();
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
	<!-- Restrict autopilot's location pool to lit cities. ON for kiosk
	     installs so the camera never wanders to ocean / desert / mountain
	     and dimmed the scene. OFF lets the director use the full pool. -->
	<Toggle label="Night-Lit Cities Only" checked={cfg.director.autopilot.nightLitCitiesOnly} onchange={(e) => patch('director.autopilot.nightLitCitiesOnly', e.currentTarget.checked)} />
</section>
