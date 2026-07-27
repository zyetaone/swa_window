<script lang="ts">
	/**
	 * LabControls — DEV-only SidePanel section for the lab mode on /.
	 * Exposes the same controls as /playground (mode selector + per-mode knobs)
	 * when ?lab=1 is active. Not bundled in production (import.meta.env.DEV gate).
	 */
	import { setParallaxRole } from '$lib/model/config-tree.svelte';
	import DevWingTuner from '$lib/world/three/DevWingTuner.svelte';
	import type { AeroWindow } from '$lib/model/aero-window.svelte';

	type LabMode = 'cesium' | 'hybrid' | 'night-lab';
	const ROLE_FOV = { left: 42, center: 45, right: 42, solo: 45 } as const;

	let {
		mode = $bindable('cesium' as LabMode),
		model,
	}: {
		mode?: LabMode;
		model: AeroWindow;
	} = $props();
</script>

<fieldset>
	<legend>Renderer</legend>
	<select value={mode} onchange={(e) => { mode = (e.currentTarget as HTMLSelectElement).value as LabMode; }}>
		<option value="cesium">Cesium (DOM effects)</option>
		<option value="hybrid">Hybrid (Cesium + Three)</option>
		<option value="night-lab">Night Lab (variants)</option>
	</select>
</fieldset>

{#if mode === 'hybrid'}
	{#if import.meta.env.DEV}
		<DevWingTuner />
	{/if}

	<fieldset>
		<legend>HUD</legend>
		<label style="display:flex;align-items:center;gap:6px;font-size:11px;">
			<input type="checkbox" bind:checked={model.config.shell.clockVisible} />
			Show clock
		</label>
	</fieldset>

	<fieldset>
		<legend>Night city flyover</legend>
		<button type="button"
			onclick={() => {
				const turningOn = model.config.camera.flyoverPitchDeg === 0;
				model.applyConfigPatch('camera.flyoverPitchDeg', turningOn ? -60 : 0);
				if (turningOn) { model.setLocation(model.location); model.setTime(2); model.setAltitude(8000); model.onUserInteraction('altitude'); }
			}}
			style="font-size:11px;padding:4px 8px;background:rgba(127,174,255,0.12);border:1px solid rgba(127,174,255,0.3);border-radius:4px;color:#cdddff;cursor:pointer;width:100%;">
			{model.config.camera.flyoverPitchDeg !== 0 ? '✓ Flyover active' : 'Night City Flyover'}
		</button>
	</fieldset>

	<fieldset>
		<legend>3-Pi Role</legend>
		<select value={model.config.camera.parallax.role}
			onchange={(e) => {
				const role = (e.currentTarget as HTMLSelectElement).value as keyof typeof ROLE_FOV;
				setParallaxRole(role); model.config.camera.parallax.fovDeg = ROLE_FOV[role];
			}}>
			<option value="solo">solo</option>
			<option value="left">left</option>
			<option value="center">center</option>
			<option value="right">right</option>
		</select>
	</fieldset>
{:else if mode === 'cesium'}
	<fieldset>
		<legend>Clouds</legend>
		<label style="font-size:11px;">Density
			<input type="range" bind:value={model.config.atmosphere.clouds.density} min="0" max="1" step="0.01" style="width:100%;" />
		</label>
		<label style="font-size:11px;">Speed
			<input type="range" bind:value={model.config.atmosphere.clouds.speed} min="0.1" max="3" step="0.1" style="width:100%;" />
		</label>
	</fieldset>
{/if}
