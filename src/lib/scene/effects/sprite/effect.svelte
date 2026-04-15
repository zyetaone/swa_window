<script lang="ts">
	/**
	 * sprite — Cesium Billboard at a geo-position.
	 *
	 * Mounts a CustomDataSource with one Billboard entity. Image URL points
	 * to either a static asset or an uploaded asset served by /api/assets/[name].
	 * altitude omitted = clamped to terrain (ground-level signs, landmarks);
	 * altitude set = absolute meters above ellipsoid (passing planes, balloons).
	 *
	 * No DOM output — all rendering inside the Cesium canvas.
	 */
	import { activeCesium } from '$lib/cesium/active.svelte';
	import type { EffectProps } from '../../types';
	import type { SpriteParams } from './types';

	let { params }: EffectProps<SpriteParams> = $props();

	$effect(() => {
		const mgr = activeCesium.manager;
		if (!mgr || !params) return;
		const Cesium = mgr.getCesium();
		const viewer = mgr.getViewer();

		const ds = new Cesium.CustomDataSource(`sprite-${params.image}`);
		viewer.dataSources.add(ds);

		const clamped = params.altitude === undefined;
		ds.entities.add({
			position: clamped
				? Cesium.Cartesian3.fromDegrees(params.lon, params.lat)
				: Cesium.Cartesian3.fromDegrees(params.lon, params.lat, params.altitude),
			billboard: {
				image: params.image,
				width: params.width ?? 48,
				height: params.height ?? 48,
				heightReference: clamped
					? Cesium.HeightReference.CLAMP_TO_GROUND
					: Cesium.HeightReference.NONE,
				disableDepthTestDistance: Number.POSITIVE_INFINITY,
			},
		});

		return () => {
			viewer.dataSources.remove(ds, true);
		};
	});
</script>
