<script lang="ts">
	/**
	 * LightingControls — dual-tree operator panel (kiosk SidePanel + /admin).
	 *
	 * Two sections, one component (KISS — shared usePanelConfig + peer-sync):
	 *   Lighting — night/VIIRS/exposure knobs
	 *   Display  — quality, overlay, buildings, shell chrome, wing
	 *
	 * All writes go through applyConfigPatch. Admin ambient fans out via
	 * PEER_SYNC_PATHS in peer-sync.svelte.
	 */
	import { patchNum, usePanelConfig } from './patch';
	import { NIGHT_LIGHT_SCALE_MAX } from '$lib/world/altitude';
	import { clearOverlayDisabled } from '$lib/world/lifecycle-overlay-recovery';
	import { QUALITY_MODES, type QualityMode } from '$lib/types';
	import Toggle from './Toggle.svelte';
	import RangeSlider from './RangeSlider.svelte';

	const { cfg, patch } = usePanelConfig();

	const QUALITY_LABELS: Record<QualityMode, string> = {
		performance: 'Performance (Pi/Raspberry)',
		balanced: 'Balanced (default)',
		ultra: 'Ultra (high-end)',
	};
</script>

<section>
	<h4>Lighting</h4>
	<RangeSlider
		label="Night Lights (VIIRS scale)"
		min={0}
		max={NIGHT_LIGHT_SCALE_MAX}
		step={0.1}
		value={cfg.world.nightLightIntensity}
		oninput={patchNum(patch, 'world.nightLightIntensity')}
		formatValue={(v) => v.toFixed(1)}
	/>
	<RangeSlider
		id="additiveStrength"
		label="City Light Punch"
		min={0}
		max={15}
		step={0.25}
		value={cfg.world.additiveStrength}
		oninput={patchNum(patch, 'world.additiveStrength')}
		formatValue={(v) => v.toFixed(1)}
	/>
	<RangeSlider
		id="moonlightIntensity"
		label="Moonlight Peak"
		min={0.035}
		max={0.3}
		step={0.005}
		value={cfg.world.moonlightIntensity}
		oninput={patchNum(patch, 'world.moonlightIntensity')}
		formatValue={(v) => v.toFixed(3)}
	/>
	<RangeSlider
		id="skyDarken"
		label="Sky Darken"
		min={0.5}
		max={4.0}
		step={0.05}
		value={cfg.world.skyDarken}
		oninput={patchNum(patch, 'world.skyDarken')}
		formatValue={(v) => v.toFixed(2)}
	/>
	<RangeSlider
		id="nightExposure"
		label="Night Exposure"
		min={0.4}
		max={1.5}
		step={0.025}
		value={cfg.world.nightExposure}
		oninput={patchNum(patch, 'world.nightExposure')}
		formatValue={(v) => v.toFixed(2)}
	/>
	<RangeSlider
		id="viirsBrightness"
		label="VIIRS Brightness ×"
		min={0.5}
		max={3.0}
		step={0.05}
		value={cfg.world.viirsBrightness}
		oninput={patchNum(patch, 'world.viirsBrightness')}
		formatValue={(v) => v.toFixed(2)}
	/>
	<Toggle label="Hash Palette (Night)" checked={cfg.world.useHashPalette} onchange={(e) => patch('world.useHashPalette', e.currentTarget.checked)} />
</section>

<section>
	<h4>Display</h4>
	<label class="quality">
		<span class="quality-label">
			<span>Quality (fleet)</span>
			<span class="quality-value">{cfg.world.qualityMode}</span>
		</span>
		<select
			class="quality-select"
			value={cfg.world.qualityMode}
			onchange={(e) => patch('world.qualityMode', e.currentTarget.value)}
		>
			{#each QUALITY_MODES as mode (mode)}
				<option value={mode}>{QUALITY_LABELS[mode]}</option>
			{/each}
		</select>
	</label>
	<!-- Toggling Three ON clears the persisted low-fps auto-disable so it
	     does not clobber the choice on next boot. -->
	<!-- Daisy-chain: peer-synced + ambient-persisted — all panes share wing/Three
	     and quality like one multi-monitor chain (see SIMPLIFICATION-DECISIONS). -->
	<Toggle label="Three.js Overlay (fleet)" checked={cfg.world.useThreeOverlay} onchange={(e) => {
		const on = e.currentTarget.checked;
		patch('world.useThreeOverlay', on);
		if (on) clearOverlayDisabled();
	}} />
	<Toggle label="3D Buildings" checked={cfg.world.buildingsEnabled} onchange={(e) => patch('world.buildingsEnabled', e.currentTarget.checked)} />
	<Toggle label="Cesium Clouds (auto-off when Three.js overlay active)" checked={cfg.world.useCesiumClouds} onchange={(e) => patch('world.useCesiumClouds', e.currentTarget.checked)} />
	<Toggle label="Window Frame" checked={cfg.shell.windowFrame} onchange={(e) => patch('shell.windowFrame', e.currentTarget.checked)} />
	<!-- Open-blind "En route / place" whisper. Closed-blind time card is independent. -->
	<Toggle label="Destination Whisper" checked={cfg.shell.hudVisible} onchange={(e) => patch('shell.hudVisible', e.currentTarget.checked)} />
	<Toggle label="Cabin Clock" checked={cfg.shell.clockVisible} onchange={(e) => patch('shell.clockVisible', e.currentTarget.checked)} />
	<Toggle label="Touch (Demo Mode)" checked={cfg.shell.touchEnabled} onchange={(e) => patch('shell.touchEnabled', e.currentTarget.checked)} />
	<Toggle label="Cursor Parallax" checked={cfg.shell.mouseParallax} onchange={(e) => patch('shell.mouseParallax', e.currentTarget.checked)} />
	<RangeSlider id="wingX" label="Wing Position" min={-12} max={2} step={0.1}
		value={cfg.world.wingXBase}
		oninput={patchNum(patch, 'world.wingXBase')}
		formatValue={(v) => v.toFixed(1)} />
	<Toggle label="Wing Mirror Flip" checked={cfg.world.wingDriftSign === -1} onchange={(e) => patch('world.wingDriftSign', e.currentTarget.checked ? -1 : 1)} />
</section>

<style>
	.quality {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.75rem;
		opacity: 0.9;
	}
	.quality-label {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
	}
	.quality-value {
		opacity: 0.7;
		text-transform: capitalize;
	}
	.quality-select {
		width: 100%;
		padding: 0.35rem 0.5rem;
		border-radius: 6px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(0, 0, 0, 0.35);
		color: inherit;
		font: inherit;
	}
</style>
