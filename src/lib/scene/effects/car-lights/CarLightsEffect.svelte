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
	import { CAR_LIGHTS_NIGHT_THRESHOLD } from '$lib/night';
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
		// Initial visibility gate. The reactive $effect below will keep this
		// in sync on subsequent nightFactor changes — but without the seed
		// here, the dots render by default (Cesium DataSource.show defaults
		// true) until nightFactor first transitions, leaving midday dots
		// visible for minutes at a time.
		ds.show = model.nightFactor > CAR_LIGHTS_NIGHT_THRESHOLD;
		viewer.dataSources.add(ds);

		return () => {
			// Guard for HMR: viewer may already be destroyed (Cesium's
			// get dataSources throws "Cannot read properties of undefined")
			// before our teardown runs.
			if (ds && !viewer.isDestroyed?.()) {
				try { viewer.dataSources.remove(ds, true); } catch {}
			}
			ds = null;
		};
	});

	// Reactive gate — follows nightFactor for the component's lifetime.
	// Dots fade in around dusk (nf crosses 0.2) and stay visible through
	// night → dawn. Note: this effect's dependency on `ds` isn't tracked
	// (plain let, not $state), but that's OK — useCesiumEffect above seeds
	// the initial value and all subsequent writes come through THIS effect
	// when nightFactor changes.
	$effect(() => {
		if (ds) ds.show = model.nightFactor > CAR_LIGHTS_NIGHT_THRESHOLD;
	});
</script>
