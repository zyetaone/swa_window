<script module lang="ts">
	/** Result of the segment builder. positions: pairs of XYZ endpoints. */
	export interface NeonSegments {
		positions: Float32Array;
		colors?: Float32Array;
	}
</script>

<script lang="ts" generics="F">
	/**
	 * NeonLineLayer — generic two-pass (halo + core) neon-line renderer for
	 * GeoJSON-style features fetched from `${endpoint}/${location}`.
	 *
	 * Consolidates the 85%-identical pipeline that OsmBuildingEdges and
	 * OsmRoads used to each implement separately:
	 *   - fetch + abort controller
	 *   - LineSegments2 + LineMaterial × 2 (core + halo, both additive)
	 *   - ENU anchor matrix via shared helper
	 *   - useTask altitude gate + opacity + resolution sync
	 *   - disposal hygiene on rebuild + unmount
	 *
	 * Each consumer supplies:
	 *   - `endpoint`   the URL prefix (e.g. `/api/buildings` or `/api/roads`)
	 *   - `buildSegments`  a pure function that takes raw features + city
	 *                      lat/lon and returns a flat positions array plus
	 *                      optional per-vertex colours
	 *   - colours, widths, opacity multipliers — visual tuning
	 *
	 * Two consumers today (buildings, roads). Future layers (POI markers,
	 * water boundaries, area boundaries) slot in by writing only their
	 * `buildSegments` closure — about 30 lines instead of 200.
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
	import { enuAnchorMatrix } from './enu';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';

	/** Generic geo feature collection — buildSegments callbacks narrow F. */
	interface FeatureCollection<T> {
		features: T[];
	}

	let {
		location,
		endpoint,
		coreColor,
		coreWidth,
		haloColor,
		haloWidth,
		haloOpacityMul,
		intensityMul = 1,
		gateStartFt = 25000,
		gateEndFt = 60000,
		buildSegments,
	}: {
		location: LocationId;
		endpoint: string;
		coreColor: number;
		coreWidth: number;
		haloColor: number;
		haloWidth: number;
		haloOpacityMul: number;
		/** Multiplier applied to (nightFactor - 0.15) when computing opacity. */
		intensityMul?: number;
		/** Altitude (ft) at which the layer is fully visible; fades to gateEndFt. */
		gateStartFt?: number;
		gateEndFt?: number;
		buildSegments: (features: F[], lat0: number, lon0: number) => NeonSegments | null;
	} = $props();

	const model = useAeroWindow();
	const nightFactor = $derived(model.nightFactor);
	const ctx = useThrelte();

	let geometry = $state.raw<LineSegmentsGeometry | null>(null);
	let anchorMatrix = $state.raw<Matrix4 | null>(null);
	let pendingDispose: LineSegmentsGeometry | null = null;
	let group: ThreeGroup | undefined = $state.raw();

	// Snapshot the material-static props at construction time. These are
	// per-mount constants, not reactive — destructuring into locals tells
	// Svelte's compiler "we intentionally capture once, no closure needed."
	const _coreColor = coreColor as number;
	const _coreWidth = coreWidth as number;
	const _haloColor = haloColor as number;
	const _haloWidth = haloWidth as number;

	const coreMaterial = new LineMaterial({
		color: _coreColor,
		linewidth: _coreWidth,
		transparent: true,
		opacity: 0,
		blending: AdditiveBlending,
		depthWrite: false,
		worldUnits: false,
		vertexColors: true,
	});
	const haloMaterial = new LineMaterial({
		color: _haloColor,
		linewidth: _haloWidth,
		transparent: true,
		opacity: 0,
		blending: AdditiveBlending,
		depthWrite: false,
		worldUnits: false,
		vertexColors: true,
	});

	const _scratch = new Vector2();

	useTask(() => {
		const camAlt = model.flight.camAlt;
		const altGate = camAlt <= gateStartFt
			? 1
			: Math.max(0, 1 - (camAlt - gateStartFt) / (gateEndFt - gateStartFt));
		const intensity = Math.max(0, nightFactor - 0.15) * intensityMul * altGate;
		coreMaterial.opacity = intensity;
		haloMaterial.opacity = intensity * haloOpacityMul;

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
		fetch(`${endpoint}/${location}`, { signal: ctrl.signal })
			.then((r) => r.json() as Promise<FeatureCollection<F>>)
			.then((data) => {
				if (!data.features?.length) return;
				const result = buildSegments(data.features, loc.lat, loc.lon);
				if (!result || result.positions.length === 0) return;
				const geom = new LineSegmentsGeometry();
				geom.setPositions(result.positions);
				if (result.colors) geom.setColors(result.colors);
				pendingDispose = geom;
				geometry = geom;
				anchorMatrix = enuAnchorMatrix(loc.lat, loc.lon, 0);
			})
			.catch((e) => {
				if (e.name !== 'AbortError') console.warn(`[NeonLineLayer ${endpoint}]`, e);
			});
		return () => ctrl.abort();
	});

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
