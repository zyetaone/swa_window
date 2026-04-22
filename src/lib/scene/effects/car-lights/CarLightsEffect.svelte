<script lang="ts">
	/**
	 * Car lights — Cesium-native geo-positioned effect.
	 *
	 * Mounts a CustomDataSource with Point entities clamped to ground.
	 * Points are procedurally scattered around the current location and
	 * classified as headlight / taillight / emergency flicker by rand.
	 *
	 * Output: no DOM. All rendering happens inside the Cesium canvas.
	 */
	import { LOCATION_MAP } from '$lib/locations';
	import { useCesiumEffect } from '$lib/world/active.svelte';
	import type { EffectProps } from '../../types';
	import { seedDots, lightClass, lightColorBytes } from './rules';

	let { model }: EffectProps = $props();

	const LIGHT_COUNT = 350;
	const LIGHT_RADIUS_DEG = 0.08;

	let ds: ReturnType<typeof makeDataSource> | null = null;

	function makeDataSource(Cesium: typeof import('cesium'), loc: { lat: number; lon: number }) {
		const datasource = new Cesium.CustomDataSource('car-lights');
		const seeds = seedDots(loc.lat, loc.lon, LIGHT_COUNT, LIGHT_RADIUS_DEG);
		for (const seed of seeds) {
			const [r, g, b, a] = lightColorBytes(lightClass(seed.rand));
			datasource.entities.add({
				position: Cesium.Cartesian3.fromDegrees(seed.lon, seed.lat),
				point: {
					color: Cesium.Color.fromBytes(r, g, b, a),
					pixelSize: 2.5,
					heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
					scaleByDistance: new Cesium.NearFarScalar(2000, 2.5, 80000, 0.4),
					disableDepthTestDistance: Number.POSITIVE_INFINITY,
				},
			});
		}
		return datasource;
	}

	useCesiumEffect((_mgr, Cesium, viewer) => {
		const loc = LOCATION_MAP.get(model.location);
		if (!loc) return;

		ds = makeDataSource(Cesium, loc);
		viewer.dataSources.add(ds);

		return () => {
			if (ds) {
				viewer.dataSources.remove(ds, true);
				ds = null;
			}
		};
	});

	// Hide the dots during the day — they're meant to read as headlights +
	// taillights at night, not scatter in broad daylight. Threshold at 0.2
	// lets them fade in around dusk and stay visible through to dawn.
	$effect(() => {
		if (ds) ds.show = model.nightFactor > 0.2;
	});
</script>
