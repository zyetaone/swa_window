<script lang="ts">
	/**
	 * OsmRoads — road LineStrings traced as glowing two-layer neon lines.
	 *
	 * Thin wrapper around NeonLineLayer with a buildSegments closure that
	 * converts OSM LineString features into LineSegments endpoint pairs +
	 * per-class colour. Cool warm-white palette so roads register as a
	 * distinct lighting type from the warm sodium building footprints.
	 *
	 * Per-class color contributes the urban hierarchy: motorway / trunk
	 * brightest (mercury-vapour street-lamp feel), residential streets
	 * quietest. Vertex-color values can exceed 1.0 to brighten major
	 * arteries beyond the material's base tint.
	 */
	import NeonLineLayer, { type NeonSegments } from './NeonLineLayer.svelte';
	import type { LocationId } from '$lib/types';
	import { EARTH_RADIUS_M } from './state.svelte';

	let { location }: { location: LocationId } = $props();

	interface RoadFeature {
		type: 'Feature';
		geometry: { type: 'LineString'; coordinates: [number, number][] };
		properties: { class?: string };
	}

	const CLASS_COLOUR: Record<string, [number, number, number]> = {
		motorway:    [1.30, 1.38, 1.45],
		trunk:       [1.30, 1.38, 1.45],
		primary:     [1.10, 1.20, 1.32],
		secondary:   [0.90, 1.00, 1.12],
		tertiary:    [0.70, 0.80, 0.92],
		residential: [0.48, 0.55, 0.65],
	};
	const DEFAULT_COLOUR: [number, number, number] = [0.48, 0.55, 0.65];

	function buildRoadLines(
		features: RoadFeature[],
		lat0: number,
		lon0: number,
	): NeonSegments | null {
		const cosLat0 = Math.cos((lat0 * Math.PI) / 180);
		const R = EARTH_RADIUS_M;

		let totalVerts = 0;
		for (const f of features) {
			const ring = f.geometry.coordinates;
			if (!ring || ring.length < 2) continue;
			totalVerts += 2 * (ring.length - 1);
		}
		if (totalVerts === 0) return null;

		const positions = new Float32Array(totalVerts * 3);
		const colors    = new Float32Array(totalVerts * 3);
		let off = 0;

		for (const f of features) {
			const ring = f.geometry.coordinates;
			if (!ring || ring.length < 2) continue;
			const cls = f.properties.class ?? 'residential';
			const c = CLASS_COLOUR[cls] ?? DEFAULT_COLOUR;

			for (let i = 0; i < ring.length - 1; i++) {
				const [lonA, latA] = ring[i];
				const [lonB, latB] = ring[i + 1];
				const ex0 = ((lonA - lon0) * Math.PI) / 180 * cosLat0 * R;
				const nz0 = ((latA - lat0) * Math.PI) / 180 * R;
				const ex1 = ((lonB - lon0) * Math.PI) / 180 * cosLat0 * R;
				const nz1 = ((latB - lat0) * Math.PI) / 180 * R;

				// Lift roads 0.5 m above the ellipsoid so they don't z-fight
				// with terrain. ENU local frame: y is up.
				positions[off + 0] = ex0;  positions[off + 1] = 0.5;  positions[off + 2] = -nz0;
				colors[off + 0] = c[0];    colors[off + 1] = c[1];    colors[off + 2] = c[2];
				off += 3;
				positions[off + 0] = ex1;  positions[off + 1] = 0.5;  positions[off + 2] = -nz1;
				colors[off + 0] = c[0];    colors[off + 1] = c[1];    colors[off + 2] = c[2];
				off += 3;
			}
		}

		return { positions, colors };
	}
</script>

<NeonLineLayer
	{location}
	endpoint="/api/roads"
	coreColor={0xeaf4ff}
	coreWidth={2.0}
	haloColor={0x8ab0d8}
	haloWidth={5.5}
	haloOpacityMul={0.55}
	intensityMul={1.1}
	buildSegments={buildRoadLines}
/>
