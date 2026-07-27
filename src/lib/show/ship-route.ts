/**
 * Ship route boot setup — extracted from +page.svelte.
 *
 * URL param parsing, parallax role init, real-time clock sync.
 * Pure functions that take model + LocationId helpers.
 * Called once at boot before the component tree mounts.
 */

import type { AeroWindow } from '$lib/model/aero-window.svelte';
import { isValidLocation } from '$content/locations';
import { isValidWeather, isValidDeviceRole, type DeviceRole } from '$lib/types';
import { setParallaxRole } from '$lib/model/config-tree.svelte';

const ROLE_KEY = 'aero.device.role';

export interface ShipRouteOptions {
	/** AeroWindow model (boot config + reactive state). */
	model: AeroWindow;
	/** Current URL search params (from window.location.search). */
	params: URLSearchParams;
}

/**
 * Apply URL search params + persisted parallax role to the boot model.
 * Call once in the root page's top-level script.
 */
export function applyShipRoute(opts: ShipRouteOptions): void {
	const { model, params } = opts;

	// --- Location ---
	const locParam = params.get('location')?.toLowerCase();
	if (isValidLocation(locParam)) model.setLocation(locParam);

	// --- Altitude (clamp at bound, same semantics as the slider) ---
	const altParam = params.get('altitude');
	if (altParam) {
		const alt = Number(altParam);
		if (Number.isFinite(alt)) model.setAltitude(alt);
	}

	// --- Time of day (disables real-time sync) ---
	const timeParam = params.get('time');
	if (timeParam !== null && timeParam !== '') {
		const t = Number(timeParam);
		if (Number.isFinite(t) && t >= 0 && t <= 24) {
			model.syncToRealTime = false;
			model.setTime(t);
		}
	}

	// --- Weather ---
	const weatherParam = params.get('weather')?.toLowerCase();
	if (isValidWeather(weatherParam)) model.setWeather(weatherParam);

	// --- Three overlay force on/off (perf-gate A/B) ---
	const overlayParam = params.get('overlay');
	if (overlayParam === '1' || overlayParam === 'true') {
		model.applyConfigPatch('world.useThreeOverlay', true);
	} else if (overlayParam === '0' || overlayParam === 'false') {
		model.applyConfigPatch('world.useThreeOverlay', false);
	}

	// --- Hash palette A/B ---
	const hpParam = params.get('hashpalette');
	if (hpParam === '1' || hpParam === 'true') {
		model.applyConfigPatch('world.useHashPalette', true);
	} else if (hpParam === '0' || hpParam === 'false') {
		model.applyConfigPatch('world.useHashPalette', false);
	}

	// --- Multi-Pi parallax role ---
	const roleParam = params.get('role')?.toLowerCase();
	const fromUrl = isValidDeviceRole(roleParam) ? roleParam : null;
	const stored = localStorage.getItem(ROLE_KEY);
	const fromStorage = isValidDeviceRole(stored) ? stored : null;
	const chosenRole: DeviceRole = fromUrl ?? fromStorage ?? 'solo';

	if (chosenRole !== 'solo') {
		model.applyConfigPatch('camera.parallax.role', chosenRole);
		setParallaxRole(chosenRole);
		model.applyConfigPatch('shell.windowFrame', false);
	}
	if (fromUrl) localStorage.setItem(ROLE_KEY, fromUrl);
}

/**
 * Start real-time clock sync interval. Returns cleanup function.
 * Use in an $effect or onMount.
 */
export function startTimeSync(model: AeroWindow): () => void {
	const update = () => model.updateTimeFromSystem();
	const id = setInterval(update, model.config.director.daylight.syncIntervalMs);
	return () => clearInterval(id);
}
