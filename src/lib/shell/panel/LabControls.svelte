<script lang="ts">
	/**
	 * LabControls — DEV-only SidePanel section for the lab mode on /.
	 * Exposes the same controls as /playground (mode selector + per-mode knobs)
	 * when ?lab=1 is active. Not bundled in production (import.meta.env.DEV gate).
	 */
	import { setParallaxRole } from '$lib/model/config-tree.svelte';
	import { DEVICE_ROLES, type DeviceRole } from '$lib/types';
		import type { AeroWindow } from '$lib/model/aero-window.svelte';
	import { patchNum } from '$lib/shell/panel/patch';
	import RangeSlider from '$lib/shell/panel/RangeSlider.svelte';
	import Toggle from '$lib/shell/panel/Toggle.svelte';

	type LabMode = 'cesium' | 'hybrid' | 'night-lab';
	// Record<DeviceRole, …> rather than a bare object literal: adding a role to
	// DEVICE_ROLES becomes a compile error here until it gets an FOV, instead of
	// an undefined lookup that silently writes NaN into camera.parallax.fovDeg.
	const ROLE_FOV: Record<DeviceRole, number> = { left: 42, center: 45, right: 42, solo: 45 };

	let {
		mode = $bindable('cesium' as LabMode),
		model,
	}: {
		mode?: LabMode;
		model: AeroWindow;
	} = $props();

	// Closure, not .bind(model): referencing the prop at call time keeps the
	// compiler's state_referenced_locally warning quiet.
	const patch = (path: string, value: unknown) => model.applyConfigPatch(path, value);
</script>

<fieldset>
	<legend>Renderer</legend>
	<select class="lab-select" value={mode} onchange={(e) => {
		const next = (e.currentTarget as HTMLSelectElement).value as LabMode;
		mode = next;
		// The renderer selector is the ONLY lab writer of useThreeOverlay — the
		// write lives here (user interaction) rather than a page-level $effect.
		// Night Lab needs the overlay: variants E/F render through Three.
		model.applyConfigPatch('world.useThreeOverlay', next !== 'cesium');
	}}>
		<option value="cesium">Cesium (DOM effects)</option>
		<option value="hybrid">Hybrid (Cesium + Three)</option>
		<option value="night-lab">Night Lab (variants)</option>
	</select>
</fieldset>

{#if mode === 'hybrid'}
	<fieldset>
		<legend>HUD</legend>
	<Toggle label="Show clock" checked={model.config.shell.clockVisible} onchange={(e) => model.applyConfigPatch('shell.clockVisible', e.currentTarget.checked)} />
	</fieldset>

	<fieldset>
		<legend>Night city flyover</legend>
		<button type="button" class="lab-btn"
			onclick={() => {
				const turningOn = model.config.camera.flyoverPitchDeg === 0;
				model.applyConfigPatch('camera.flyoverPitchDeg', turningOn ? -60 : 0);
				if (turningOn) { model.setLocation(model.location); model.setTime(2); model.setAltitude(8000); model.onUserInteraction('altitude'); }
			}}>
			{model.config.camera.flyoverPitchDeg !== 0 ? '✓ Flyover active' : 'Night City Flyover'}
		</button>
	</fieldset>

	<fieldset>
		<legend>3-Pi Role</legend>
		<select class="lab-select" value={model.config.camera.parallax.role}
			onchange={(e) => {
				const role = (e.currentTarget as HTMLSelectElement).value as DeviceRole;
				setParallaxRole(role); model.applyConfigPatch('camera.parallax.fovDeg', ROLE_FOV[role]);
			}}>
			<!-- Iterated from the DEVICE_ROLES SSOT so the lab picker can never
			     offer a different set than the roles the app actually accepts. -->
			{#each DEVICE_ROLES as role (role)}
				<option value={role}>{role}</option>
			{/each}
		</select>
	</fieldset>
{:else if mode === 'cesium'}
	<fieldset>
		<legend>Clouds</legend>
	<RangeSlider label="Density" value={model.config.atmosphere.clouds.density} oninput={patchNum(patch, 'atmosphere.clouds.density')} min={0} max={1} step={0.01} />
	<RangeSlider label="Speed" value={model.config.atmosphere.clouds.speed} oninput={patchNum(patch, 'atmosphere.clouds.speed')} min={0.1} max={3} step={0.1} />
	</fieldset>
{/if}

<style>
	/* Picker-btn surface, matching the shared panel family. */
	.lab-select {
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 5px;
		color: rgba(255, 255, 255, 0.85);
		font-size: 0.75rem;
		padding: 0.45rem 0.75rem;
		width: 100%;
	}

	/* Same visual language as NightVariantPanel's .reset button. */
	.lab-btn {
		width: 100%;
		font-size: 11px;
		padding: 6px;
		background: rgba(127, 174, 255, 0.12);
		border: 1px solid rgba(127, 174, 255, 0.3);
		border-radius: 6px;
		color: #cdddff;
		cursor: pointer;
		transition: background 0.2s ease;
	}
	.lab-btn:hover {
		background: rgba(127, 174, 255, 0.22);
	}
</style>
