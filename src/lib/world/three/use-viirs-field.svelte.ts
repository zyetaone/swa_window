/**
 * useViirsField — composable that loads the VIIRS field for a location
 * and reactively updates when the field becomes available. Used by
 * CityLightField, CityGlowDome, and NeonLineLayer.
 */
import { getViirsField, removeViirsWaiter, type ViirsField } from '$lib/world/viirs-field';
import type { LocationId } from '$lib/types';
import { LOCATION_MAP } from '$content/locations';
export function useViirsField(
	getLocation: () => LocationId,
	getEnabled: () => boolean = () => true,
): { current: ViirsField | null } {
	let viirsField = $state.raw<ViirsField | null>(null);

	$effect(() => {
		const location = getLocation();
		const enabled = getEnabled();
		if (!enabled) { viirsField = null; return; }
		const loc = LOCATION_MAP.get(location);
		if (!loc) { viirsField = null; return; }
		const onReady = () => { viirsField = getViirsField(loc.lat, loc.lon); };
		viirsField = getViirsField(loc.lat, loc.lon, onReady);
		return () => removeViirsWaiter(loc.lat, loc.lon, onReady);
	});

	return { get current() { return viirsField; } };
}
