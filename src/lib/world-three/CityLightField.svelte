<script lang="ts">
	/**
	 * CityLightField — the "carpet of city lights from afar" a passenger sees at
	 * cruise: thousands of soft warm BOKEH dots scattered across the WHOLE metro,
	 * placed by sampling the NASA VIIRS night-lights field so they sit where the
	 * lights actually are — dense over the cores, thinning out across the suburbs,
	 * fading to nothing past the edge of the lit area.
	 *
	 * Why a separate layer: from 30k ft you can't resolve individual roads — the
	 * city reads as a field of twinkling soft dots. The sharp neon (OsmRoads /
	 * OsmBuildingEdges) is the NEAR/detail layer that fades IN as you descend;
	 * this bokeh field is the FAR layer that's strong at cruise and crossfades
	 * OUT as the detail resolves — one smooth altitude handoff, no popping.
	 *
	 * ── Design (the rebuild) ──────────────────────────────────────────────────
	 * The first cut clustered everything onto the brightest core and left the
	 * rest of the city dark, in blocky clumps. Four things fix that:
	 *   1. BILINEAR VIIRS sampling — smooths the coarse ~1.2 km tile grid so the
	 *      field is continuous, not blocky; also averages away single-pixel
	 *      sensor noise so we can use a LOW floor without orphan dots.
	 *   2. FLAT-baseline keep-probability — every lit cell keeps SOME dots
	 *      (baseline), brightness only adds MORE on top. Density tracks the
	 *      lights but covers the whole metro instead of collapsing to the core.
	 *   3. SEEDED SUBSAMPLE to the cap — collect all candidates, then randomly
	 *      thin to MAX_POINTS. The old top-left grid scan hit the cap mid-grid
	 *      and starved the rest of the city; a seeded shuffle spreads the cap
	 *      uniformly across the whole footprint.
	 *   4. PER-DOT variation — independent random size + warm-hue pick per dot,
	 *      a rich sodium→amber→warm-white palette with rare cool LED accents,
	 *      small point sizes, tight falloff (no milky overlap). Alpha tracks
	 *      brightness so the dim outskirts fade out naturally at the edge.
	 *
	 * One Points draw call, ≤MAX_POINTS, custom shader. depthTest on + log-depth
	 * chunks so the wing occludes it. Placement is SEEDED (createSeededRng(
	 * daySeed())) so all three Pis in a panorama see the identical field —
	 * invariant #4. ENU-anchored at the city centroid (same pattern as OsmRoads).
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
	import { LOCATION_MAP, groundAltM } from '$content/locations';
	import type { LocationId } from '$lib/types';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { enuAnchorMatrix, applyEnuAnchor } from './enu';
	import { smoothstep } from '$lib/utils';
	import { createSeededRng, daySeed } from './prng';
	import { getViirsField, removeViirsWaiter, type ViirsField } from './viirs-field';
	import { EARTH_RADIUS_M } from './state.svelte';
	import { altitudeDetailMix } from '$lib/world-lighting/altitude';
	import { lightingState } from './lighting';

	let { location }: { location: LocationId } = $props();

	const model = useAeroWindow();

	// Patch + sampling. ~42 km square around the centroid (covers a full metro
	// + its lit fringe), a fine candidate grid sampled BILINEARLY against VIIRS,
	// kept probabilistically so density tracks the real light distribution while
	// still covering the whole lit area. Capped + seeded-subsampled for the Pi
	// (one draw call regardless of metro size).
	const PATCH_M = 42000; // ~42 km — whole metro + lit fringe
	const GRID = 160; // 160² candidates → ~262 m spacing
	const MAX_POINTS = 4000; // small dots → one cheap draw call even at 4k
	// Low floor — bilinear smoothing means a lone bright VIIRS noise pixel is
	// averaged down by its dark neighbours, so 0.05 catches genuine suburb glow
	// without resurrecting the rural orphan dots the old high floor suppressed.
	const BRIGHT_FLOOR = 0.05;
	// Keep-probability = baseline everywhere lit + brightness on top. The flat
	// baseline guarantees the suburbs get dots (no "dark everywhere"); the
	// brightness term concentrates the cores. smoothstep upper bound 0.55 so the
	// core saturates to full density well before peak brightness.
	const KEEP_BASELINE = 0.22;
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
	// for placement, jitter, twinkle phase, size + colour variance → identical on
	// every Pi for a given day. Rebuilds on location change or VIIRS arrival.
	$effect(() => {
		const vf = viirsField;
		const loc = LOCATION_MAP.get(location);
		if (!loc || !vf) { geometry = null; return; }

		untrack(() => {
			const rng = createSeededRng(daySeed() ^ Math.round(loc.lat * 1e4));
			const lat0 = loc.lat, lon0 = loc.lon;
			const cosLat0 = Math.cos(lat0 * RAD) || 1e-6;
			const halfDeg = PATCH_M / 2 / EARTH_RADIUS_M / RAD; // half-patch in degrees of lat

			// Pass 1 — collect every kept candidate (no cap yet, so the cap can be
			// applied uniformly across the whole footprint in pass 2).
			const east: number[] = [];
			const north: number[] = [];
			const up: number[] = [];
			const bright: number[] = [];
			const phase: number[] = [];
			const size: number[] = [];
			const warm: number[] = [];
			for (let gy = 0; gy < GRID; gy++) {
				for (let gx = 0; gx < GRID; gx++) {
					// Cell centre + seeded jitter so the grid never reads as a grid.
					const fx = (gx + rng()) / GRID - 0.5; // -0.5..0.5
					const fy = (gy + rng()) / GRID - 0.5;
					const lat = lat0 + fy * 2 * halfDeg;
					const lon = lon0 + (fx * 2 * halfDeg) / cosLat0;
					const b = vf.sampleBilinear(lat, lon);
					if (b < BRIGHT_FLOOR) continue; // truly dark → no dot
					// Flat baseline + brightness boost: suburbs keep ~0.22, cores
					// saturate to ~1.0. Spreads dots across the whole lit metro.
					const keepP = KEEP_BASELINE + (1 - KEEP_BASELINE) * smoothstep((b - BRIGHT_FLOOR) / (0.55 - BRIGHT_FLOOR));
					if (rng() > keepP) continue;
					east.push((lon - lon0) * RAD * cosLat0 * EARTH_RADIUS_M);
					north.push((lat - lat0) * RAD * EARTH_RADIUS_M);
					up.push(0.5 + rng() * 3.5); // hug the ground (0.5–4 m)
					bright.push(b);
					phase.push(rng() * Math.PI * 2);
					// Per-dot size 0.5–1.6× (independent of brightness) so the
					// field has a real spread of dot sizes, not one uniform size.
					size.push(0.5 + rng() * 1.1);
					// Per-dot warm-hue pick 0..1 (independent of brightness) →
					// sodium / amber / warm-white mix + rare cool LED, full variety
					// even across the dim suburbs.
					warm.push(rng());
				}
			}

			pendingDispose?.dispose();
			const total = bright.length;
			if (total === 0) { geometry = null; anchorMatrix = null; return; }

			// Pass 2 — uniform seeded subsample to the cap. Partial Fisher-Yates
			// over an index array; take the first min(total, MAX_POINTS). Spreads
			// the cap across the whole footprint instead of starving late cells.
			const idx = new Int32Array(total);
			for (let i = 0; i < total; i++) idx[i] = i;
			const keep = Math.min(total, MAX_POINTS);
			for (let i = 0; i < keep; i++) {
				const j = i + Math.floor(rng() * (total - i));
				const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
			}

			const posArr = new Float32Array(keep * 3);
			const brightArr = new Float32Array(keep);
			const phaseArr = new Float32Array(keep);
			const sizeArr = new Float32Array(keep);
			const warmArr = new Float32Array(keep);
			for (let k = 0; k < keep; k++) {
				const s = idx[k];
				posArr[k * 3 + 0] = east[s];
				posArr[k * 3 + 1] = up[s];
				posArr[k * 3 + 2] = -north[s]; // local ENU (x=E, y=up, z=-N)
				brightArr[k] = bright[s];
				phaseArr[k] = phase[s];
				sizeArr[k] = size[s];
				warmArr[k] = warm[s];
			}

			const g = new BufferGeometry();
			g.setAttribute('position', new BufferAttribute(posArr, 3));
			g.setAttribute('aBright', new BufferAttribute(brightArr, 1));
			g.setAttribute('aPhase', new BufferAttribute(phaseArr, 1));
			g.setAttribute('aSize', new BufferAttribute(sizeArr, 1));
			g.setAttribute('aWarm', new BufferAttribute(warmArr, 1));
			pendingDispose = g;
			geometry = g;
			anchorMatrix = enuAnchorMatrix(lat0, lon0, groundAltM(location));
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
			uPixel: { value: 16.0 }, // smaller base point-size scale (was 26)
		},
		vertexShader: /* glsl */ `
			#include <common>
			#include <logdepthbuf_pars_vertex>
			attribute float aBright;
			attribute float aPhase;
			attribute float aSize;
			attribute float aWarm;
			uniform float uTime;
			uniform float uIntensity;
			uniform float uPixel;
			varying float vAlpha;
			varying float vBright;
			varying float vWarm;
			void main() {
				vec4 mv = modelViewMatrix * vec4(position, 1.0);
				gl_Position = projectionMatrix * mv;
				// Slow atmospheric twinkle — city lights seen from afar shimmer
				// gently (two irrational freqs, modest amplitude). Per-frame, so
				// individual Pis don't lock phase (only placement is shared).
				float tw = 1.0 + 0.16 * (0.6 * sin(uTime * 0.7 + aPhase * 2.0)
				                         + 0.4 * sin(uTime * 1.9 + aPhase * 5.3));
				// Dot size: per-dot aSize × a mild brightness term × distance
				// attenuation. Small, clamped to a tight range so dots stay
				// crisp points and never bloom into a milky blob.
				float dist = max(-mv.z, 1.0);
				gl_PointSize = clamp(uPixel * aSize * (0.45 + aBright) * tw * (150000.0 / dist), 1.0, 9.0);
				vBright = aBright;
				vWarm = aWarm;
				// Alpha tracks brightness → the dim outskirts are faint and the
				// field fades out at its edge naturally (no hard square boundary).
				vAlpha = uIntensity * (0.22 + aBright * 0.70) * tw;
				#include <logdepthbuf_vertex>
			}
		`,
		fragmentShader: /* glsl */ `
			#include <common>
			#include <logdepthbuf_pars_fragment>
			varying float vAlpha;
			varying float vBright;
			varying float vWarm;
			void main() {
				#include <logdepthbuf_fragment>
				// Tight round bokeh falloff — crisp dot, small soft halo, so
				// overlapping dots add cleanly instead of smearing into a sheet.
				vec2 d = gl_PointCoord - vec2(0.5);
				float r = length(d) * 2.0;
				if (r > 1.0) discard;
				float soft = pow(1.0 - r, 2.2);
				// Warm city-light palette with per-dot hue variety:
				//   sodium (deep orange) → amber → warm-white, + rare cool LED.
				vec3 sodium = vec3(1.0, 0.50, 0.18);
				vec3 amber  = vec3(1.0, 0.70, 0.36);
				vec3 warmW  = vec3(1.0, 0.88, 0.70);
				vec3 coolW  = vec3(0.78, 0.86, 1.0);
				vec3 c = mix(sodium, amber, smoothstep(0.0, 0.5, vWarm));
				c = mix(c, warmW, smoothstep(0.5, 0.9, vWarm));
				c = mix(c, coolW, smoothstep(0.93, 1.0, vWarm)); // rare LED/mercury district
				// Brightest cores burn a touch hotter/whiter (hot centre).
				c = mix(c, vec3(1.0, 0.96, 0.88), smoothstep(0.65, 1.0, vBright) * 0.45);
				gl_FragColor = vec4(c, soft * vAlpha);
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
		if (group && anchorMatrix) applyEnuAnchor(group, anchorMatrix);
	});

	useTask((dt) => {
		material.uniforms.uTime.value += dt;
		const { camAlt, nf, tod } = untrack(() => ({
			camAlt: model.flight.camAlt, nf: model.nightFactor, tod: model.timeOfDay,
		}));
		// FAR layer of the shared altitudeDetailMix SSOT: far layers scale by
		// (1 − mix) — full at cruise, fading toward the ground where the sharp
		// neon detail (the NEAR layers, which scale by mix) takes over. The 0.15
		// floor keeps a little sparkle low so there's no hard cut; one smooth
		// handoff across all night-light layers, no popping.
		const altFar = 0.15 + 0.85 * (1 - altitudeDetailMix(camAlt));
		// Night onset from the SHARED cityLightAmount curve (lighting SSOT) — the
		// SAME discrete-lights driver the neon streets read, so the carpet and the
		// streets come on together instead of each on its own raw-nf threshold.
		material.uniforms.uIntensity.value = lightingState(tod, nf).cityLightAmount * altFar;
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
