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
	import { LOCATION_MAP } from '$content/locations';
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
					// Smaller hard pixel — the bloom post-process widens these
					// into soft halos that pool with VIIRS. A small bright dot
					// lets bloom dominate the visual; a big dot reads pixelated.
					pixelSize: 1.6,
					heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
					// Sharper near→far ramp: scale up close (a moving plane
					// sees pin-sharp lights right below) and shrink hard at
					// distance so the far city dissolves into VIIRS wash.
					scaleByDistance: new Cesium.NearFarScalar(1500, 3.0, 60000, 0.25),
					// Translucency falloff doubles up with scale so distant
					// dots fade entirely instead of compressing into shimmer.
					translucencyByDistance: new Cesium.NearFarScalar(1500, 1.0, 60000, 0.0),
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
