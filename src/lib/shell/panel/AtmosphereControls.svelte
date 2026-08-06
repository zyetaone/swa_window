<script lang="ts">
	/**
	 * AtmosphereControls — cloud density / cloud speed / haze sliders.
	 * Routes operator writes through applyConfigPatch — see
	 * docs/ARCHITECTURE.md non-goals: `applyConfigPatch` is the single
	 * write gate for the CRDT LWW merge and the prototype-pollution
	 * defense. Direct `config.X = v` skips the gate and silently
	 * breaks fleet sync.
	 *
	 * Mounted in two trees: the kiosk SidePanel (AeroWindow context —
	 * model.applyConfigPatch adds telemetry + fleet broadcast) and /admin
	 * (no context — module-level gate; startPeerSync propagates to peers).
	 */
	import { patchNum, usePanelConfig } from './patch';
	import RangeSlider from './RangeSlider.svelte';

	const { cfg, patch } = usePanelConfig();
</script>
	<section>
	<h4>Atmosphere</h4>
		<RangeSlider
		label="Cloud Cover"
		min={0}
		max={1.0}
		step={0.05}
		value={cfg.atmosphere.clouds.density}
		oninput={patchNum(patch, 'atmosphere.clouds.density')}
		formatValue={(v) => Math.round(v * 100) + '%'}
	/>
	<RangeSlider
		id="cloudSpeed"
		label="Cloud Speed"
		min={cfg.director.ambient.cloudSpeedMin}
		max={cfg.director.ambient.cloudSpeedMax}
		step={0.1}
		value={cfg.atmosphere.clouds.speed}
		oninput={patchNum(patch, 'atmosphere.clouds.speed')}
		formatValue={(v) => v.toFixed(1) + 'x'}
	/>
	<RangeSlider
		id="haze"
		label="Haze"
		min={cfg.atmosphere.haze.min}
		max={cfg.atmosphere.haze.max}
		step={0.005}
		value={cfg.atmosphere.haze.amount}
		oninput={patchNum(patch, 'atmosphere.haze.amount')}
		formatValue={(v) => Math.round(v * 100) + '%'}
	/>
</section>
