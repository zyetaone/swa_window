<script lang="ts">
	/**
	 * Earth — textured sphere with the full real-data texture stack:
	 *
	 *   map             day.jpg       Blue Marble colour (sRGB)
	 *   emissiveMap     night.jpg     city lights (sRGB)
	 *   normalMap       normal.jpg    surface relief (linear)
	 *   displacementMap height.jpg    real elevation (linear)
	 *
	 * At WGS84 scale the displacement is meaningful in metres —
	 * `displacementScale = 9000` lifts white-pixel (Everest-range) terrain
	 * by 9 km above the ellipsoid surface. Geometry segments bumped
	 * 256×128 → 512×256 (~520 k vertices) so individual mountain ranges
	 * resolve at the displacement's native frequency.
	 *
	 * Source: bumpmap from turban/webgl-earth (derived from public SRTM
	 * elevation data). Normal + specular maps from Three.js examples
	 * (CC0). Day/night + clouds from NASA Blue Marble (public domain).
	 */
	import { T } from '@threlte/core';
	import { useTexture } from '@threlte/extras';
	import { Color, SRGBColorSpace, NoColorSpace } from 'three';
	import { EARTH_RADIUS_M } from './state.svelte';

	let {
		nightFactor,
		nightIntensity,
	}: {
		nightFactor: number;
		nightIntensity: number;
	} = $props();

	// useTexture rejects if any URL 404s. We wrap with a fallback so a
	// missing asset still mounts the mesh with a solid-colour DataTexture
	// instead of leaving the sphere transparent. The kiosk install
	// network is intermittent — a half-rendered globe is worse than a
	// stylised one.
	const texturesPromise = useTexture([
		'/textures/earth/day.jpg',
		'/textures/earth/night.jpg',
		'/textures/earth/normal.jpg',
		'/textures/earth/height.jpg',
	]).catch((e) => {
		console.warn('[Earth] texture load failed — falling back to procedural:', e);
		return null as never;
	});

	const emissiveTint = new Color(0xffaa55);
	const emissiveStrength = $derived(nightFactor * 1.4 * nightIntensity);

	// normalScale tuned for cruise altitude — too low = no relief, too
	// high = exaggerated alien-looking shading at oblique sun angles.
	// Threlte accepts [x, y] tuple; T proxies it to a Three Vector2.
	const NORMAL_SCALE: [number, number] = [0.85, 0.85];

	// Real elevation range on Earth (Everest ≈ 8.85 km). Slight overshoot
	// to 9 000 m so the bumpmap's brightest pixels read as sharp ridges.
	const DISPLACEMENT_SCALE_M = 9000;
</script>

{#await texturesPromise then loaded}
	{#if loaded}
		{@const [dayMap, nightMap, normalMap, heightMap] = loaded}
	<!--
	  Colour maps need sRGB decoding (gamma 2.2 from JPGs). Normal +
	  height are linear data (encoded as colour but interpreted as
	  vectors / scalars by Three's shader), so they stay in NoColorSpace.
	-->
	<T.Mesh>
		<T.SphereGeometry args={[EARTH_RADIUS_M, 512, 256]} />
		<T.MeshStandardMaterial
			map={dayMap}
			emissiveMap={nightMap}
			emissive={emissiveTint}
			emissiveIntensity={emissiveStrength}
			normalMap={normalMap}
			normalScale={NORMAL_SCALE}
			displacementMap={heightMap}
			displacementScale={DISPLACEMENT_SCALE_M}
			roughness={0.92}
			metalness={0.0}
			oncreate={() => {
				dayMap.colorSpace    = SRGBColorSpace;
				nightMap.colorSpace  = SRGBColorSpace;
				normalMap.colorSpace = NoColorSpace;
				heightMap.colorSpace = NoColorSpace;
				dayMap.needsUpdate    = true;
				nightMap.needsUpdate  = true;
				normalMap.needsUpdate = true;
				heightMap.needsUpdate = true;
			}}
		/>
	</T.Mesh>
	{:else}
		<!-- Texture load failed (e.g. install network 404). Render a
		     solid-coloured sphere so the scene still has an Earth-shaped
		     object in frame rather than a transparent void. -->
		<T.Mesh>
			<T.SphereGeometry args={[EARTH_RADIUS_M, 96, 48]} />
			<T.MeshStandardMaterial color={0x223344} roughness={0.95} />
		</T.Mesh>
	{/if}
{/await}
