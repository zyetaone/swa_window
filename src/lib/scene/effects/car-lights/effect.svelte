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
	import { activeCesium } from '$lib/world/active.svelte';
	import type { EffectProps } from '../../types';
	import { seedDots, lightClass, lightColorBytes } from './rules';

	let { model }: EffectProps = $props();

	const LIGHT_COUNT = 350;
	const LIGHT_RADIUS_DEG = 0.08; // ~9 km at equator

	$effect(() => {
		const mgr = activeCesium.manager;
		if (!mgr) return;

		const loc = LOCATION_MAP.get(model.location);
		if (!loc) return;

		const Cesium = mgr.getCesium();
		const viewer = mgr.getViewer();

		const ds = new Cesium.CustomDataSource('car-lights');
		viewer.dataSources.add(ds);

		const seeds = seedDots(loc.lat, loc.lon, LIGHT_COUNT, LIGHT_RADIUS_DEG);
		for (const seed of seeds) {
			const [r, g, b, a] = lightColorBytes(lightClass(seed.rand));
			ds.entities.add({
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

		return () => {
			viewer.dataSources.remove(ds, true);
		};
	});
</script>
