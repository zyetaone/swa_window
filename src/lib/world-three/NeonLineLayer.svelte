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
	import { untrack } from 'svelte';
	import { T, useTask, useThrelte } from '@threlte/core';
	import {
		Matrix4,
		AdditiveBlending,
		type Group as ThreeGroup,
	} from 'three';
	import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
	import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
	import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
	import { LOCATION_MAP } from '$content/locations';
	import type { LocationId } from '$lib/types';
	import { enuAnchorMatrix } from './enu';
	import { EARTH_RADIUS_M } from './state.svelte';
	import { getViirsField, type ViirsField } from './viirs-field';
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
		dashed = false,
		dashSize = 0,
		gapSize = 0,
		dashFlow = 0,
		depthFade = 0,
		viirsModulate = false,
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
		/**
		 * Render the lines as dashes/dots instead of solid. `dashSize` /
		 * `gapSize` are in world metres (positions are metres in the ENU
		 * frame). When true, geometry line-distances are computed on build and
		 * both core + halo share the same dash phase so the glow tracks each
		 * dot. Per-mount constant — pass a literal.
		 */
		dashed?: boolean;
		dashSize?: number;
		gapSize?: number;
		/**
		 * Animate the dash phase by this many world-metres per second (negative
		 * crawls the dots "forward" along each segment) — a slow traffic-flow
		 * shimmer on the dotted lines. Only meaningful when `dashed`.
		 */
		dashFlow?: number;
		/**
		 * Atmospheric depth fade. When > 0, per-vertex colours are dimmed and
		 * cool-shifted by planar distance (metres) from the city centre (the
		 * ENU group origin): the core glows warm, the outskirts recede into
		 * cool haze. Build-time, deterministic. 0 disables.
		 */
		depthFade?: number;
		/**
		 * Drive per-vertex brightness from the NASA VIIRS night-lights field for
		 * `location` — bright cores brighten, dark outskirts dim — so the neon
		 * derives from the same satellite ground-truth as the Cesium VIIRS imagery.
		 * Loads one tile async; until ready (or on CORS failure) the static
		 * per-vertex colours are used unchanged.
		 */
		viirsModulate?: boolean;
		buildSegments: (features: F[], lat0: number, lon0: number) => NeonSegments | null;
	} = $props();

	const model = useAeroWindow();
	const nightFactor = $derived(model.nightFactor);
	const ctx = useThrelte();

	let geometry = $state.raw<LineSegmentsGeometry | null>(null);
	let anchorMatrix = $state.raw<Matrix4 | null>(null);
	let pendingDispose: LineSegmentsGeometry | null = null;
	let group: ThreeGroup | undefined = $state.raw();

	// VIIRS brightness field for `location` (night-lights integration). Loaded
	// async when viirsModulate is on; setting it re-runs the build effect below
	// to bake the satellite-driven brightness into the vertex colours.
	let viirsField = $state.raw<ViirsField | null>(null);
	$effect(() => {
		if (!viirsModulate) { viirsField = null; return; }
		const loc = LOCATION_MAP.get(location);
		if (!loc) { viirsField = null; return; }
		viirsField = getViirsField(loc.lat, loc.lon, () => {
			viirsField = getViirsField(loc.lat, loc.lon);
		});
	});

	// Snapshot the material-static props at construction time. These are
	// per-mount constants — LineMaterial is constructed ONCE and never
	// re-created when the caller's props change (callers pass literal
	// numbers anyway; OsmRoads/OsmBuildingEdges are the only consumers).
	// The `svelte-ignore` directives suppress Svelte 5's reactive-capture
	// warning since the one-shot capture is intentional here.
	// svelte-ignore state_referenced_locally
	const _coreColor = coreColor as number;
	// svelte-ignore state_referenced_locally
	const _coreWidth = coreWidth as number;
	// svelte-ignore state_referenced_locally
	const _haloColor = haloColor as number;
	// svelte-ignore state_referenced_locally
	const _haloWidth = haloWidth as number;
	// svelte-ignore state_referenced_locally
	const _dashed = dashed as boolean;
	// svelte-ignore state_referenced_locally
	const _dashSize = dashSize as number;
	// svelte-ignore state_referenced_locally
	const _gapSize = gapSize as number;
	// svelte-ignore state_referenced_locally
	const _dashFlow = dashFlow as number;
	// svelte-ignore state_referenced_locally
	const _depthFade = depthFade as number;

	// Dash params are per-mount constants. Setting `dashed:true` at
	// construction bakes the USE_DASH shader define; it can't be toggled later
	// without a defines recompile, which we never need (callers pass literals).
	const dashOpts = _dashed
		? { dashed: true, dashSize: _dashSize, gapSize: _gapSize }
		: {};

	const coreMaterial = new LineMaterial({
		color: _coreColor,
		linewidth: _coreWidth,
		transparent: true,
		opacity: 0,
		blending: AdditiveBlending,
		depthWrite: false,
		worldUnits: false,
		vertexColors: true,
		...dashOpts,
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
		...dashOpts,
	});

	// LineMaterial.resolution only needs syncing when the renderer size
	// actually changes — was running every frame in useTask before. Now
	// gated to a $effect on ctx.size.current so it only fires on resize.
	$effect(() => {
		const { width, height } = ctx.size.current;
		coreMaterial.resolution.set(width, height);
		haloMaterial.resolution.set(width, height);
	});

	useTask((delta) => {
		const { camAlt, nf } = untrack(() => ({ camAlt: model.flight.camAlt, nf: nightFactor }));
		const altGate = camAlt <= gateStartFt
			? 1
			: Math.max(0, 1 - (camAlt - gateStartFt) / (gateEndFt - gateStartFt));
		const intensity = Math.max(0, nf - 0.15) * intensityMul * altGate;
		coreMaterial.opacity = intensity;
		haloMaterial.opacity = intensity * haloOpacityMul;
		// Traffic-flow shimmer: crawl the dash phase. Both passes share the
		// offset so the glow tracks each dot. dashOffset is a LineMaterial
		// uniform; bumping two floats/frame is free.
		if (_dashed && _dashFlow) {
			coreMaterial.dashOffset -= _dashFlow * delta;
			haloMaterial.dashOffset = coreMaterial.dashOffset;
		}
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
		// Read viirsField so this effect re-runs (rebuilds) once the tile loads.
		const vfield = viirsModulate ? viirsField : null;
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
				// Atmospheric depth fade — dim + cool-shift each vertex by its
				// planar distance from the city centre (group origin). Mutates a
				// copy of the colours so the core glows warm and the outskirts
				// haze out. Blue fades least → far lights read cooler.
				if (_depthFade > 0 && result.colors) {
					const p = result.positions, col = result.colors;
					const near = _depthFade * 0.2;
					for (let i = 0; i < col.length; i += 3) {
						const d = Math.hypot(p[i], p[i + 2]); // ENU: x east, z north
						const f = Math.max(0, Math.min(1, 1 - (d - near) / (_depthFade - near)));
						col[i] *= 0.18 + 0.82 * f;     // R fades most
						col[i + 1] *= 0.28 + 0.72 * f; // G
						col[i + 2] *= 0.42 + 0.58 * f; // B fades least (cool haze)
					}
				}
				// VIIRS night-lights modulation — scale each vertex by the satellite
				// brightness at its lat/lon (recovered from the ENU position), so the
				// neon tracks the real city: lit cores pop, dark edges recede. Runs
				// after depthFade; the two compound. Static colours kept until the
				// tile loads (or if the fetch/CORS read failed → vfield stays null).
				if (vfield && result.colors) {
					const p = result.positions, col = result.colors;
					const lat0 = loc.lat, lon0 = loc.lon;
					const cosLat0 = Math.cos((lat0 * Math.PI) / 180) || 1e-6;
					const RAD = 180 / Math.PI;
					for (let i = 0; i < col.length; i += 3) {
						const lon = lon0 + (p[i] / (cosLat0 * EARTH_RADIUS_M)) * RAD;
						const lat = lat0 + (-p[i + 2] / EARTH_RADIUS_M) * RAD;
						const f = 0.3 + 1.1 * vfield.sample(lat, lon); // dark→0.3, bright→1.4
						col[i] *= f; col[i + 1] *= f; col[i + 2] *= f;
					}
				}
				const geom = new LineSegmentsGeometry();
				geom.setPositions(result.positions);
				if (result.colors) geom.setColors(result.colors);
				// Dashing needs per-vertex line distances; each road segment is
				// a disjoint 2-point pair so the dash phase restarts per segment.
				// computeLineDistances is real on LineSegmentsGeometry but absent
				// from the bundled addon .d.ts — narrow cast over `any`.
				if (_dashed) {
					(geom as LineSegmentsGeometry & {
						computeLineDistances: () => LineSegmentsGeometry;
					}).computeLineDistances();
				}
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
