<script lang="ts">
	/**
	 * OsmRoads — road LineStrings traced as glowing two-layer neon lines.
	 *
	 * Thin wrapper around NeonLineLayer with a buildSegments closure that
	 * converts OSM LineString features into LineSegments endpoint pairs +
	 * per-class colour. WARM sodium palette (was cool blue-white) so the roads
	 * join the same warm city-light family as the VIIRS aggregate, the building
	 * window emissive and the CityGlowDome — one cohesive luminous city instead
	 * of a cool neon grid fighting a warm skyline.
	 *
	 * Per-class colour contributes the urban hierarchy: motorway / trunk
	 * brightest (sodium street-lamp feel), residential streets quietest.
	 */
	import NeonLineLayer, { type NeonSegments } from './NeonLineLayer.svelte';
	import type { LocationId } from '$lib/types';
	import { EARTH_RADIUS_M } from './state.svelte';
	import { STREET_CORE, STREET_HALO, hexOf } from '$content/palettes';

	let { location }: { location: LocationId } = $props();

	interface RoadFeature {
		type: 'Feature';
		geometry: { type: 'LineString'; coordinates: [number, number][] };
		properties: { class?: string };
	}

	// WARM sodium palette (R>G>B) so roads read as part of the warm city, not a
	// cool blue-white grid laid on top of it. Kept below 1.0 so they don't blow
	// out to hot discs under bloom; hierarchy preserved by relative brightness.
	const CLASS_COLOUR: Record<string, [number, number, number]> = {
		motorway:    [1.00, 0.86, 0.58],
		trunk:       [1.00, 0.86, 0.58],
		primary:     [0.86, 0.72, 0.47],
		secondary:   [0.68, 0.56, 0.36],
		tertiary:    [0.52, 0.42, 0.27],
		residential: [0.38, 0.30, 0.19],
	};
	const DEFAULT_COLOUR: [number, number, number] = [0.38, 0.30, 0.19];

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

<!--
	Dashed/dotted roads: 32 m dash + 38 m gap (70 m period) reads as a DENSE
	string of streetlight dots from altitude rather than a continuous painted
	line — softer, more "city traced in light" than "road map". dashFlow 6 m/s
	is a lazy traffic crawl (20 was a visible sprint — user: "too few and too
	fast"). Sizes are in ENU world metres (see buildRoadLines). Both core +
	halo share the dash phase so the glow pulses with each dot.
-->
<NeonLineLayer
	{location}
	endpoint="/api/roads"
	coreColor={hexOf(STREET_CORE)}
	coreWidth={1.5}
	haloColor={hexOf(STREET_HALO)}
	haloWidth={4.5}
	haloOpacityMul={0.45}
	intensityMul={0.6}
	dashed
	dashSize={32}
	gapSize={38}
	dashFlow={6}
	depthFade={12000}
	viirsModulate
	buildSegments={buildRoadLines}
/>
