<script lang="ts">
	/**
	 * CityLightField — the "carpet of city lights from afar" a passenger sees at
	 * cruise: thousands of soft warm BOKEH points scattered over the metro,
	 * placed by sampling the NASA VIIRS night-lights field so they sit where the
	 * lights actually are (dense over the core, sparse at the outskirts).
	 *
	 * Why a separate layer: from 30k ft you can't resolve individual roads — the
	 * city reads as a field of twinkling soft dots. The sharp neon (OsmRoads /
	 * OsmBuildingEdges) is the NEAR/detail layer that fades IN as you descend;
	 * this bokeh field is the FAR layer that's strong at cruise and crossfades
	 * OUT as the detail resolves — one smooth altitude handoff instead of layers
	 * popping in and out.
	 *
	 * One Points draw call, ≤MAX_POINTS, custom shader (soft round sprite +
	 * size attenuation + per-point slow twinkle). depthTest on + log-depth chunks
	 * so the wing occludes it. Placement is SEEDED (createSeededRng(daySeed())),
	 * so all three Pis in a panorama see the identical light field — invariant #4.
	 *
	 * ENU-anchored at the city centroid (same pattern as OsmRoads / CityGlowDome).
	 */
	import { untrack } from 'svelte';
	import { T, useTask } from '@threlte/core';
	import {
		BufferGeometry,
		BufferAttribute,
		ShaderMaterial,
		AdditiveBlending,
		Points,
		type Group as ThreeGroup,
		type Matrix4,
	} from 'three';
	import { LOCATION_MAP } from '$content/locations';
	import type { LocationId } from '$lib/types';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { enuAnchorMatrix } from './enu';
	import { createSeededRng, daySeed } from './prng';
	import { getViirsField, removeViirsWaiter, type ViirsField } from './viirs-field';
	import { EARTH_RADIUS_M } from './state.svelte';

	let { location }: { location: LocationId } = $props();

	const model = useAeroWindow();

	// Patch + sampling. ~46 km square around the centroid (covers a metro), a
	// fine candidate grid sampled against VIIRS, kept probabilistically by
	// brightness so the density tracks the real light distribution. Capped for
	// the Pi (one draw call regardless).
	const PATCH_M = 46000;
	const GRID = 150; // 150² = 22,500 candidates → ~307 m spacing
	const MAX_POINTS = 4000;
	const RAD = Math.PI / 180;

	let geometry = $state.raw<BufferGeometry | null>(null);
	let anchorMatrix = $state.raw<Matrix4 | null>(null);
	let pendingDispose: BufferGeometry | null = null;

	// VIIRS field for the active location (loaded async; rebuild on ready).
	let viirsField = $state.raw<ViirsField | null>(null);
	$effect(() => {
		const loc = LOCATION_MAP.get(location);
		if (!loc) { viirsField = null; return; }
		const onReady = () => { viirsField = getViirsField(loc.lat, loc.lon); };
		viirsField = getViirsField(loc.lat, loc.lon, onReady);
		return () => removeViirsWaiter(loc.lat, loc.lon, onReady);
	});

	// Build the point cloud from the VIIRS field. Deterministic: one seeded RNG
	// for placement, jitter, twinkle phase, colour variance → identical on every
	// Pi for a given day. Rebuilds on location change or VIIRS arrival.
	$effect(() => {
		const vf = viirsField;
		const loc = LOCATION_MAP.get(location);
		if (!loc || !vf) { geometry = null; return; }

		untrack(() => {
			const rng = createSeededRng(daySeed() ^ Math.round(loc.lat * 1e4));
			const lat0 = loc.lat, lon0 = loc.lon;
			const cosLat0 = Math.cos(lat0 * RAD) || 1e-6;
			const halfDeg = PATCH_M / 2 / EARTH_RADIUS_M / RAD; // half-patch in degrees of lat
			// World metres per ENU axis, from the centroid.
			const pos: number[] = [];
			const bright: number[] = [];
			const phase: number[] = [];
			for (let gy = 0; gy < GRID; gy++) {
				for (let gx = 0; gx < GRID; gx++) {
					// Cell centre + seeded jitter so the grid never reads as a grid.
					const fx = (gx + rng()) / GRID - 0.5; // -0.5..0.5
					const fy = (gy + rng()) / GRID - 0.5;
					const lat = lat0 + fy * 2 * halfDeg;
					const lon = lon0 + (fx * 2 * halfDeg) / cosLat0;
					const b = vf.sample(lat, lon);
					if (b < 0.05) continue;
					// Keep probabilistically by brightness — dense cores, sparse
					// edges — instead of a uniform grid.
					if (rng() > Math.pow(b, 0.6)) continue;
					const east = (lon - lon0) * RAD * cosLat0 * EARTH_RADIUS_M;
					const north = (lat - lat0) * RAD * EARTH_RADIUS_M;
					pos.push(east, 2 + rng() * 25, -north); // local ENU (x=E, y=up, z=-N)
					bright.push(b);
					phase.push(rng() * Math.PI * 2);
					if (bright.length >= MAX_POINTS) break;
				}
				if (bright.length >= MAX_POINTS) break;
			}

			pendingDispose?.dispose();
			if (bright.length === 0) { geometry = null; anchorMatrix = null; return; }
			const g = new BufferGeometry();
			g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
			g.setAttribute('aBright', new BufferAttribute(new Float32Array(bright), 1));
			g.setAttribute('aPhase', new BufferAttribute(new Float32Array(phase), 1));
			pendingDispose = g;
			geometry = g;
			anchorMatrix = enuAnchorMatrix(lat0, lon0, 0);
		});
	});

	const material = new ShaderMaterial({
		transparent: true,
		depthWrite: false,
		depthTest: true, // wing (sole depth writer) occludes the field
		blending: AdditiveBlending,
		uniforms: {
			uTime: { value: 0 },
			uIntensity: { value: 0 },
			uPixel: { value: 26.0 }, // base point-size scale (tuned)
		},
		vertexShader: /* glsl */ `
			#include <common>
			#include <logdepthbuf_pars_vertex>
			attribute float aBright;
			attribute float aPhase;
			uniform float uTime;
			uniform float uIntensity;
			uniform float uPixel;
			varying float vAlpha;
			varying float vBright;
			void main() {
				vec4 mv = modelViewMatrix * vec4(position, 1.0);
				gl_Position = projectionMatrix * mv;
				// Slow atmospheric twinkle — city lights seen from afar shimmer
				// gently (two irrational freqs, modest amplitude). Per-frame, so
				// individual Pis don't lock phase (only placement is shared).
				float tw = 1.0 + 0.18 * (0.6 * sin(uTime * 0.7 + aPhase * 2.0)
				                         + 0.4 * sin(uTime * 1.9 + aPhase * 5.3));
				// Bokeh size: brighter = bigger, with distance attenuation so the
				// carpet recedes naturally. Clamped to a soft point range.
				float dist = max(-mv.z, 1.0);
				gl_PointSize = clamp(uPixel * (0.6 + aBright * 1.8) * tw * (220000.0 / dist), 1.5, 18.0);
				vBright = aBright;
				vAlpha = uIntensity * (0.35 + aBright * 0.65) * tw;
				#include <logdepthbuf_vertex>
			}
		`,
		fragmentShader: /* glsl */ `
			#include <common>
			#include <logdepthbuf_pars_fragment>
			varying float vAlpha;
			varying float vBright;
			void main() {
				#include <logdepthbuf_fragment>
				// Soft round bokeh falloff from the point centre.
				vec2 d = gl_PointCoord - vec2(0.5);
				float r = length(d) * 2.0;
				if (r > 1.0) discard;
				float soft = pow(1.0 - r, 1.8);
				// Warm sodium → warm-white at the brightest cores.
				vec3 warm = mix(vec3(1.0, 0.58, 0.24), vec3(1.0, 0.92, 0.80),
				                smoothstep(0.55, 1.0, vBright));
				gl_FragColor = vec4(warm, soft * vAlpha);
			}
		`,
	});

	const points = new Points(undefined, material);
	points.frustumCulled = false;
	$effect(() => {
		if (geometry) points.geometry = geometry;
	});

	// ENU anchor applied to the group via matrix.copy (same pattern as
	// CityGlowDome / OsmRoads) — T.Group's `matrix` prop only takes a number[].
	let group = $state.raw<ThreeGroup | undefined>();
	$effect(() => {
		if (!group || !anchorMatrix) return;
		group.matrixAutoUpdate = false;
		group.matrix.copy(anchorMatrix);
	});

	useTask((dt) => {
		material.uniforms.uTime.value += dt;
		const { camAlt, nf } = untrack(() => ({ camAlt: model.flight.camAlt, nf: model.nightFactor }));
		// FAR-layer altitude crossfade: full at cruise, fades toward the ground
		// where the sharp neon detail takes over. 18k ft → full, 6k ft → 0.2
		// (a little sparkle persists low so there's no hard cut). Inverse of the
		// neon altGate → one smooth handoff, no popping.
		const altFar = 0.2 + 0.8 * Math.max(0, Math.min(1, (camAlt - 6000) / (18000 - 6000)));
		material.uniforms.uIntensity.value = Math.max(0, nf - 0.2) * altFar;
	});

	$effect(() => () => {
		material.dispose();
		pendingDispose?.dispose();
		pendingDispose = null;
	});
</script>

{#if geometry && anchorMatrix}
	<T.Group bind:ref={group}>
		<T is={points} />
	</T.Group>
{/if}
