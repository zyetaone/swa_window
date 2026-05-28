<script lang="ts">
	/**
	 * OsmBuildingEdges — building FOOTPRINTS glowing as two-layer neon
	 * lines tracing the ground perimeter of each building.
	 *
	 * Originally rendered the full cube wireframe (top + bottom + vertical
	 * edges). Changed to footprint-only at user request: the cube cage
	 * read as "scaffolding"; the bottom-ring-only read as "city light
	 * traced on the ground" — much closer to the cinematic intent and
	 * 3× cheaper geometry.
	 *
	 * Two-layer Line2/LineMaterial pass (thin bright core + wider soft
	 * halo, both additive) gives the bloom-glow blur feel without the
	 * crispness of LineBasicMaterial.
	 *
	 * Visibility tied to nightFactor — invisible at day, peak at deep
	 * night. Altitude gate fades past 25 kft (only true cruise frames
	 * pay the line-segment cost). Edge colour is sodium-amber to
	 * harmonise with the prod night palette.
	 */
	import { T, useTask, useThrelte } from '@threlte/core';
	import {
		Matrix4,
		Vector2,
		AdditiveBlending,
		type Group as ThreeGroup,
	} from 'three';
	import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
	import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
	import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
	import { LOCATION_MAP } from '$content/locations';
	import type { LocationId } from '$lib/types';
	import { EARTH_RADIUS_M } from './state.svelte';
	import { enuAnchorMatrix } from './enu';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';

	let { location }: { location: LocationId } = $props();

	const model = useAeroWindow();
	const nightFactor = $derived(model.nightFactor);
	const ctx = useThrelte();

	interface BuildingFeature {
		type: 'Feature';
		geometry: { type: 'Polygon'; coordinates: [number, number][][] };
		properties: { height?: number };
	}
	interface BuildingsResponse {
		type: 'FeatureCollection';
		features: BuildingFeature[];
	}

	let geometry = $state.raw<LineSegmentsGeometry | null>(null);
	let anchorMatrix = $state.raw<Matrix4 | null>(null);
	let pendingDispose: LineSegmentsGeometry | null = null;
	let group: ThreeGroup | undefined = $state.raw();

	// Two materials — sharp core + soft halo. Both use vertexColors so
	// per-building brightness variation (some lit, some dark — like real
	// city districts) can ride on the geometry's color attribute. The
	// `color` field then acts as a base tint multiplied with vertex colors.
	const coreMaterial = new LineMaterial({
		color: 0xffcc88,
		linewidth: 1.6,
		transparent: true,
		opacity: 0,
		blending: AdditiveBlending,
		depthWrite: false,
		worldUnits: false,
		vertexColors: true,
	});
	const haloMaterial = new LineMaterial({
		color: 0xff8844,
		linewidth: 5.0,
		transparent: true,
		opacity: 0,
		blending: AdditiveBlending,
		depthWrite: false,
		worldUnits: false,
		vertexColors: true,
	});

	const _scratch = new Vector2();

	// Each frame: drive opacity from nightFactor + sync resolution with
	// the renderer. LineMaterial needs `resolution.set(w, h)` to compute
	// screen-space line widths correctly — must follow window resizes.
	// Altitude gate (softened from 5-12 kft → 25-60 kft): keep building
	// outlines visible across the entire cruise window. Only fade them
	// past ~45 k ft when the city is genuinely sub-pixel.
	useTask(() => {
		const camAlt = model.flight.camAlt;
		const altGate = camAlt <= 25000
			? 1
			: Math.max(0, 1 - (camAlt - 25000) / 35000);
		const intensity = Math.max(0, nightFactor - 0.15) * 1.15 * altGate;
		coreMaterial.opacity = intensity;
		haloMaterial.opacity = intensity * 0.45;

		const size = ctx.renderer.getSize(_scratch);
		coreMaterial.resolution.set(size.x, size.y);
		haloMaterial.resolution.set(size.x, size.y);
	});

	$effect(() => () => {
		coreMaterial.dispose();
		haloMaterial.dispose();
		pendingDispose?.dispose();
		pendingDispose = null;
	});

	$effect(() => {
		if (!group || !anchorMatrix) return;
		group.matrixAutoUpdate = false;
		group.matrix.copy(anchorMatrix);
	});

	$effect(() => {
		const loc = LOCATION_MAP.get(location);
		if (!loc) { geometry = null; return; }
		pendingDispose?.dispose();
		pendingDispose = null;
		geometry = null;
		const ctrl = new AbortController();
		fetch(`/api/buildings/${location}`, { signal: ctrl.signal })
			.then((r) => r.json() as Promise<BuildingsResponse>)
			.then((data) => {
				if (!data.features?.length) return;
				const built = buildEdges(data.features, loc.lat, loc.lon);
				if (built) {
					pendingDispose = built.geom;
					geometry = built.geom;
					anchorMatrix = built.matrix;
				}
			})
			.catch((e) => { if (e.name !== 'AbortError') console.warn('[OsmBuildingEdges]', e); });
		return () => ctrl.abort();
	});

	function buildEdges(
		features: BuildingFeature[],
		lat0: number,
		lon0: number,
	): { geom: LineSegmentsGeometry; matrix: Matrix4 } | null {
		const cosLat0 = Math.cos((lat0 * Math.PI) / 180);
		const R = EARTH_RADIUS_M;

		// Footprint-only mode — emit ONLY the bottom perimeter ring per
		// building (the "flow around" outline at ground level). User
		// chose this over the full cube wireframe because the cube
		// reads as scaffolding/cage; the footprint reads as city light
		// traced on the ground.
		// For each closed ring of n vertices (ring[last] == ring[0]):
		//   bottom edges = n-1 edges = 2(n-1) endpoint vertices.
		let totalVerts = 0;
		for (const f of features) {
			const ring = f.geometry.coordinates[0];
			if (!ring || ring.length < 4) continue;
			totalVerts += 2 * (ring.length - 1);
		}
		if (totalVerts === 0) return null;

		const positions = new Float32Array(totalVerts * 3);
		const colors    = new Float32Array(totalVerts * 3);
		let off = 0;

		// Hash a building's first vertex into a deterministic 0-1 value
		// so the same buildings glow brightly across location revisits —
		// stops the deck flickering as you orbit.
		const hashBrightness = (lon: number, lat: number): number => {
			const h = Math.sin(lon * 12.9898 + lat * 78.233) * 43758.5453;
			return h - Math.floor(h); // fract(h)
		};

		for (const f of features) {
			const ring = f.geometry.coordinates[0];
			if (!ring || ring.length < 4) continue;

			// Per-building "lit-ness" — real night cities have a long-tail
			// distribution: most residential blocks are dim, a few towers /
			// offices burn bright. Bias the random toward the low end with
			// a quadratic curve, then floor at 0.20 so nothing fully vanishes.
			const seed = hashBrightness(ring[0][0], ring[0][1]);
			const brightness = 0.20 + seed * seed * 0.80;

			const n = ring.length - 1;
			const xs = new Float32Array(n);
			const zs = new Float32Array(n);
			for (let i = 0; i < n; i++) {
				const [lon, lat] = ring[i];
				xs[i] = ((lon - lon0) * Math.PI) / 180 * cosLat0 * R;
				zs[i] = -((lat - lat0) * Math.PI) / 180 * R;
			}

			for (let i = 0; i < n; i++) {
				const j = (i + 1) % n;
				// Bottom edge i→j at y=0 — pair of endpoints (LineSegments)
				positions[off + 0] = xs[i]; positions[off + 1] = 0; positions[off + 2] = zs[i];
				colors[off + 0] = brightness; colors[off + 1] = brightness; colors[off + 2] = brightness;
				off += 3;
				positions[off + 0] = xs[j]; positions[off + 1] = 0; positions[off + 2] = zs[j];
				colors[off + 0] = brightness; colors[off + 1] = brightness; colors[off + 2] = brightness;
				off += 3;
			}
		}

		const geom = new LineSegmentsGeometry();
		geom.setPositions(positions);
		geom.setColors(colors);

		// Anchor frame at (lat0, lon0) — shared helper, same ENU basis Clouds uses.
		return { geom, matrix: enuAnchorMatrix(lat0, lon0, 0) };
	}

	// Long-lived LineSegments2 instances; we just swap their geometry as
	// it loads. Mounting via `<T is={…}>` keeps them outside the
	// declarative tree. LineSegments2 (vs Line2) treats positions as
	// paired endpoints, which is what our edge list produces.
	const haloLine = new LineSegments2();
	haloLine.material = haloMaterial;
	const coreLine = new LineSegments2();
	coreLine.material = coreMaterial;

	$effect(() => {
		if (!geometry) return;
		haloLine.geometry = geometry;
		coreLine.geometry = geometry;
	});
</script>

{#if geometry && anchorMatrix}
	<T.Group bind:ref={group}>
		<T is={haloLine} />
		<T is={coreLine} />
	</T.Group>
{/if}
