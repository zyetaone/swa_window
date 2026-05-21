<script lang="ts">
	/**
	 * /playground/night-lab — visual A/B comparison harness for night-light
	 * rendering variants with LIVE TUNABLE SETTINGS.
	 *
	 * Camera is pinned over Hyderabad at 22:00, autopilot off, full-bleed.
	 * Toggle through five variants live, and tweak per-variant parameters
	 * in real-time. No shell, no fleet, no commit.
	 *
	 * IMPORTANT: This route MUST NOT mutate production renderer code. All
	 * variant logic is confined here. Building tileset access is via primitive
	 * iteration (no getter added to CesiumManager).
	 */
	import { onDestroy, untrack } from 'svelte';
	import { createAeroWindow } from '$lib/model/aero-window.svelte';
	import { subscribe } from '$lib/game-loop';
	import CesiumViewer from '$lib/world/CesiumViewer.svelte';
	import { activeCesium } from '$lib/world/active.svelte';
	import { clamp } from '$lib/utils';
	import RangeSlider from '$lib/shell/panel/RangeSlider.svelte';

	type VariantId = 'A' | 'B' | 'C' | 'D' | 'E';

	interface VariantMeta {
		id: VariantId;
		label: string;
		hint: string;
	}

	const VARIANTS: VariantMeta[] = [
		{ id: 'A', label: 'Baseline', hint: 'current production renderer' },
		{ id: 'B', label: 'Bloom-after-grade', hint: 'custom additive bloom post color-grade' },
		{ id: 'C', label: 'Wider bloom sigma', hint: 'Cesium bloom σ=4.5, contrast=96' },
		{ id: 'D', label: 'Building emissive (flat)', hint: 'OSM buildings glow amber × nightFactor' },
		{ id: 'E', label: 'Altitude-aware emissive', hint: 'building × (1-alt), VIIRS × alt' },
	];

	// ─── App state setup ──────────────────────────────────────────────────────

	const model = createAeroWindow();

	// RAF — drives sim (flight tick is required so altitude/time/etc. update).
	$effect(() => subscribe((dt) => model.tick(dt)));

	// Pin to known-good test conditions on mount.
	$effect(() => {
		untrack(() => {
			// Time: deep night (22:00) — VIIRS + bloom fully active.
			model.applyConfigPatch('director.daylight.syncToRealTime', false);
			model.applyConfigPatch('director.daylight.manualTimeOfDay', 22);
			model.timeOfDay = 22;

			// Disable autopilot so location/weather stay pinned.
			model.applyConfigPatch('director.autopilot.enabled', false);

			// Full-bleed + chrome off.
			model.applyConfigPatch('shell.windowFrame', false);
			model.applyConfigPatch('shell.hudVisible', false);
			model.applyConfigPatch('shell.sidePanelOpen', false);

			// High quality — every variant should see the best-case pipeline.
			model.applyConfigPatch('world.qualityMode', 'ultra');
			// Defeat the auto-quality stepper so it can't downgrade mid-test.
			model.applyConfigPatch('world.autoQuality', false);

			// Camera: Hyderabad, mid altitude so variant E shows a real lerp.
			model.setLocation('hyderabad');
			model.flight.altitude = 28000;
		});
	});

	// ─── Variant state ────────────────────────────────────────────────────────

	let variant = $state<VariantId>('A');

	// ─── Global tunables (always visible) ─────────────────────────────────────

	const GLOBAL_DEFAULTS = { timeOfDay: 22.0, altitude: 28000 };
	const globals = $state({ ...GLOBAL_DEFAULTS });

	// Push globals → model when they change.
	$effect(() => {
		const tod = globals.timeOfDay;
		untrack(() => {
			model.applyConfigPatch('director.daylight.manualTimeOfDay', tod);
			model.timeOfDay = tod;
		});
	});
	$effect(() => {
		const alt = globals.altitude;
		untrack(() => {
			model.flight.altitude = alt;
		});
	});

	// ─── Variant-specific tunables ────────────────────────────────────────────

	const A_DEFAULTS = {
		bloomContrast: 128,
		bloomBrightness: -0.3,
		bloomSigma: 2.2,
		nightLightIntensity: 0.6,
		baseNightBrightness: 0.15,
		baseNightSaturation: 0.05,
	};
	const tunablesA = $state({ ...A_DEFAULTS });

	const B_DEFAULTS = {
		luminanceThreshold: 0.5,
		bloomIntensity: 1.0,
		tapRadius: 2,
	};
	const tunablesB = $state({ ...B_DEFAULTS });

	const C_DEFAULTS = {
		sigma: 4.5,
		contrast: 96,
		brightness: -0.3,
	};
	const tunablesC = $state({ ...C_DEFAULTS });

	const D_DEFAULTS = {
		emissiveIntensity: 0.6,
		emissiveR: 255,
		emissiveG: 180,
		emissiveB: 90,
	};
	const tunablesD = $state({ ...D_DEFAULTS });

	const E_DEFAULTS = {
		lowAltitudeFt: 15000,
		highAltitudeFt: 25000,
		viirsDimMin: 0.3,
		buildingEmissiveMax: 0.6,
	};
	const tunablesE = $state({ ...E_DEFAULTS });

	// Variant A drives prod config values directly via applyConfigPatch.
	// Push tunablesA → world config whenever they change AND variant is A.
	$effect(() => {
		if (variant !== 'A') return;
		// Reactive reads on every tunable
		const c = tunablesA.bloomContrast;
		const b = tunablesA.bloomBrightness;
		const s = tunablesA.bloomSigma;
		const nli = tunablesA.nightLightIntensity;
		const bnb = tunablesA.baseNightBrightness;
		const bns = tunablesA.baseNightSaturation;
		untrack(() => {
			model.applyConfigPatch('world.bloomContrast', c);
			model.applyConfigPatch('world.bloomBrightness', b);
			model.applyConfigPatch('world.bloomSigma', s);
			model.applyConfigPatch('world.nightLightIntensity', nli);
			model.applyConfigPatch('world.baseNightBrightness', bnb);
			model.applyConfigPatch('world.baseNightSaturation', bns);
		});
	});

	// Reset camera helper — re-pins to defaults if it drifts (orbit still runs).
	function resetCamera(): void {
		model.setLocation('hyderabad');
		globals.altitude = GLOBAL_DEFAULTS.altitude;
	}

	function resetVariantDefaults(): void {
		switch (variant) {
			case 'A':
				Object.assign(tunablesA, A_DEFAULTS);
				break;
			case 'B':
				Object.assign(tunablesB, B_DEFAULTS);
				break;
			case 'C':
				Object.assign(tunablesC, C_DEFAULTS);
				break;
			case 'D':
				Object.assign(tunablesD, D_DEFAULTS);
				break;
			case 'E':
				Object.assign(tunablesE, E_DEFAULTS);
				break;
		}
	}

	function resetAll(): void {
		Object.assign(globals, GLOBAL_DEFAULTS);
		Object.assign(tunablesA, A_DEFAULTS);
		Object.assign(tunablesB, B_DEFAULTS);
		Object.assign(tunablesC, C_DEFAULTS);
		Object.assign(tunablesD, D_DEFAULTS);
		Object.assign(tunablesE, E_DEFAULTS);
	}

	// ─── Variant application via $effect ───────────────────────────────────────
	//
	// All Cesium-side mutation happens here. Each variant runs cleanup of the
	// previous via the returned destructor before applying its own changes.
	// We capture the activeCesium.manager when it's mounted, plus react when
	// variant changes.

	$effect(() => {
		const mgr = activeCesium.manager;
		if (!mgr) return;
		const Cesium = mgr.getCesium();
		const viewer = mgr.getViewer();

		// Find the OSM buildings tileset by iterating primitives. CesiumManager
		// owns it but does not expose it; we avoid modifying compose.ts.
		function findBuildingTileset(): unknown | null {
			const prims = viewer.scene.primitives;
			for (let i = 0; i < prims.length; i++) {
				const p = prims.get(i) as unknown;
				if (p && (p as { isCesium3DTileset?: boolean }).isCesium3DTileset) return p;
				// Older Cesium versions lack isCesium3DTileset — duck-type on `style`+`tileVisible`.
				if (
					p &&
					typeof (p as { tileVisible?: unknown }).tileVisible === 'object' &&
					'style' in (p as object)
				) {
					return p;
				}
			}
			return null;
		}

		// Snapshot defaults so we can restore on cleanup.
		const bloom = viewer.scene.postProcessStages?.bloom;
		const defaultBloomEnabled = bloom?.enabled ?? false;
		const defaultBloomSigma = bloom?.uniforms?.sigma;
		const defaultBloomContrast = bloom?.uniforms?.contrast;
		const defaultBloomBrightness = bloom?.uniforms?.brightness;

		const tileset = findBuildingTileset() as
			| (object & { style?: unknown; colorBlendMode?: unknown })
			| null;
		const defaultTilesetStyle = tileset?.style ?? null;
		const defaultColorBlendMode = tileset?.colorBlendMode ?? null;

		// Track stages added by this variant so we can remove them on cleanup.
		const addedStages: unknown[] = [];

		// Tick callbacks registered on viewer.scene.postRender for live updates
		// (e.g. variant D/E need nightFactor + altitude every frame).
		const tickCallbacks: Array<() => void> = [];

		// Read current variant inside untrack — we react to the dependency
		// explicitly below so the cleanup runs before the new variant applies.
		const v = variant;

		// ── Variant application ──────────────────────────────────────────────

		if (v === 'A') {
			// Baseline — restore everything to prod defaults (no-op beyond cleanup
			// of any prior variant). The Variant-A $effect above pushes the
			// tunable values directly to the world config tree.
		}

		if (v === 'B') {
			// Disable Cesium built-in bloom; add additive custom bloom AFTER aero-color-grade.
			if (bloom) bloom.enabled = false;

			// tapRadius is read as a float in the shader for simplicity; we step
			// in integers via the slider (step:1) so casting to int inside GLSL
			// would also work. Float-with-uniform is the lighter-touch path —
			// less branching in the shader, and the offsets array indexing stays
			// the same regardless.
			const FS_BLOOM_AFTER_GRADE = `
				uniform sampler2D colorTexture;
				uniform float u_nightFactor;
				uniform float u_luminanceThreshold;
				uniform float u_bloomIntensity;
				uniform float u_tapRadius;
				in vec2 v_textureCoordinates;

				void main() {
					vec2 uv = v_textureCoordinates;
					vec4 base = texture(colorTexture, uv);
					vec2 px = vec2(1.0) / vec2(textureSize(colorTexture, 0));

					// 9-tap star pattern at ±r, ±2r, ±3r pixels (r = u_tapRadius).
					vec3 acc = vec3(0.0);
					float wsum = 0.0;
					float scale = max(u_tapRadius, 1.0);
					float weights[3] = float[3](0.4, 0.25, 0.12);
					for (int i = 0; i < 3; ++i) {
						float o = float(i + 1) * scale * 0.5;
						float w = weights[i];
						vec3 sH1 = texture(colorTexture, uv + vec2( o, 0.0) * px).rgb;
						vec3 sH2 = texture(colorTexture, uv + vec2(-o, 0.0) * px).rgb;
						vec3 sV1 = texture(colorTexture, uv + vec2(0.0,  o) * px).rgb;
						vec3 sV2 = texture(colorTexture, uv + vec2(0.0, -o) * px).rgb;
						acc += w * (sH1 + sH2 + sV1 + sV2);
						wsum += 4.0 * w;
					}
					vec3 blur = acc / max(wsum, 0.001);

					// Threshold gate — lum > u_luminanceThreshold contributes.
					float lum = dot(blur, vec3(0.2126, 0.7152, 0.0722));
					float thresh = smoothstep(u_luminanceThreshold, min(u_luminanceThreshold + 0.3, 1.0), lum);
					vec3 bloomColor = blur * thresh;

					vec3 outRgb = base.rgb + bloomColor * u_bloomIntensity * u_nightFactor;
					out_FragColor = vec4(outRgb, base.a);
				}
			`;
			try {
				const stage = new Cesium.PostProcessStage({
					name: 'night-lab-bloom-after-grade',
					fragmentShader: FS_BLOOM_AFTER_GRADE,
					uniforms: {
						u_nightFactor: () => model.nightFactor,
						u_luminanceThreshold: () => tunablesB.luminanceThreshold,
						u_bloomIntensity: () => tunablesB.bloomIntensity,
						// tapRadius is passed as float; GLSL multiplies into pixel offsets.
						u_tapRadius: () => tunablesB.tapRadius,
					},
				});
				viewer.scene.postProcessStages.add(stage);
				addedStages.push(stage);
			} catch (e) {
				console.warn('[night-lab] variant B stage failed:', e);
			}
		}

		if (v === 'C') {
			// Wider Gaussian — softer broader halos. Live-tunable via tunablesC.
			if (bloom) {
				bloom.enabled = true;
				const updateBloomC = () => {
					if (!bloom.uniforms) return;
					bloom.uniforms.sigma = tunablesC.sigma;
					bloom.uniforms.contrast = tunablesC.contrast;
					bloom.uniforms.brightness = tunablesC.brightness;
				};
				updateBloomC();
				const cb = () => updateBloomC();
				viewer.scene.postRender.addEventListener(cb);
				tickCallbacks.push(cb);
			}
		}

		if (v === 'D' || v === 'E') {
			// Building emissive — flat (D) or altitude-aware (E).
			if (tileset) {
				(tileset as { colorBlendMode?: unknown }).colorBlendMode =
					Cesium.Cesium3DTileColorBlendMode.HIGHLIGHT;

				// Track last-applied values to avoid rebuilding Cesium3DTileStyle
				// every frame when nothing changed.
				let lastEmissiveAlpha = -1;
				let lastR = -1;
				let lastG = -1;
				let lastB = -1;

				const updateStyle = () => {
					const nf = model.nightFactor;
					let emissiveAlpha: number;
					let r: number;
					let g: number;
					let b: number;
					if (v === 'D') {
						emissiveAlpha = tunablesD.emissiveIntensity * nf;
						r = tunablesD.emissiveR;
						g = tunablesD.emissiveG;
						b = tunablesD.emissiveB;
					} else {
						const lo = tunablesE.lowAltitudeFt;
						const hi = tunablesE.highAltitudeFt;
						const altBlend = clamp((model.flight.altitude - lo) / Math.max(hi - lo, 1), 0, 1);
						emissiveAlpha = tunablesE.buildingEmissiveMax * nf * (1 - altBlend);
						// E uses the prod warm amber; not separately tunable.
						r = 255;
						g = 180;
						b = 90;
					}
					if (
						Math.abs(emissiveAlpha - lastEmissiveAlpha) < 0.001 &&
						r === lastR && g === lastG && b === lastB
					) {
						return;
					}
					lastEmissiveAlpha = emissiveAlpha;
					lastR = r; lastG = g; lastB = b;
					(tileset as { style?: unknown }).style = new Cesium.Cesium3DTileStyle({
						color: `color("rgb(${r}, ${g}, ${b})", ${emissiveAlpha.toFixed(3)})`,
					});
				};

				updateStyle();
				const cb = () => updateStyle();
				viewer.scene.postRender.addEventListener(cb);
				tickCallbacks.push(cb);
			} else {
				console.warn('[night-lab] OSM building tileset not found — variant', v, 'partial');
			}

			if (v === 'E') {
				// Dim VIIRS at low altitude via nightLightIntensity (which CesiumManager
				// reads as nightLightScale → multiplies VIIRS alpha). Save + restore.
				const priorIntensity = model.config.world.nightLightIntensity;
				const updateNightIntensity = () => {
					const lo = tunablesE.lowAltitudeFt;
					const hi = tunablesE.highAltitudeFt;
					const dimMin = tunablesE.viirsDimMin;
					const altBlend = clamp((model.flight.altitude - lo) / Math.max(hi - lo, 1), 0, 1);
					const target = dimMin + (1.0 - dimMin) * altBlend;
					if (Math.abs(model.config.world.nightLightIntensity - target) > 0.01) {
						model.applyConfigPatch('world.nightLightIntensity', target);
					}
				};
				updateNightIntensity();
				const cb = () => updateNightIntensity();
				viewer.scene.postRender.addEventListener(cb);
				tickCallbacks.push(cb);

				// Restore on cleanup.
				addedStages.push({
					__restoreNightIntensity: priorIntensity,
				} as unknown);
			}
		}

		// ── Cleanup ──────────────────────────────────────────────────────────
		return () => {
			// Restore bloom defaults.
			if (bloom) {
				bloom.enabled = defaultBloomEnabled;
				if (bloom.uniforms && defaultBloomSigma !== undefined) {
					bloom.uniforms.sigma = defaultBloomSigma;
				}
				if (bloom.uniforms && defaultBloomContrast !== undefined) {
					bloom.uniforms.contrast = defaultBloomContrast;
				}
				if (bloom.uniforms && defaultBloomBrightness !== undefined) {
					bloom.uniforms.brightness = defaultBloomBrightness;
				}
			}

			// Remove any custom post-process stages we added.
			for (const s of addedStages) {
				if (s && typeof s === 'object' && '__restoreNightIntensity' in s) {
					const prior = (s as { __restoreNightIntensity: number }).__restoreNightIntensity;
					model.applyConfigPatch('world.nightLightIntensity', prior);
					continue;
				}
				try {
					viewer.scene.postProcessStages.remove(s as Parameters<typeof viewer.scene.postProcessStages.remove>[0]);
				} catch {
					// stage may have already been removed (e.g. on viewer destroy)
				}
			}

			// Unregister tick callbacks.
			for (const cb of tickCallbacks) {
				try {
					viewer.scene.postRender.removeEventListener(cb);
				} catch {
					// noop — viewer may already be torn down
				}
			}

			// Restore tileset.
			if (tileset) {
				if (defaultColorBlendMode !== null) {
					(tileset as { colorBlendMode?: unknown }).colorBlendMode = defaultColorBlendMode;
				}
				// Restore prior style — null means "no style" which is the
				// pre-syncBuildings state. CesiumManager.syncBuildings will
				// reapply its own style on the next frame anyway.
				(tileset as { style?: unknown }).style = defaultTilesetStyle ?? undefined;
			}
		};
	});

	// ─── Readouts ─────────────────────────────────────────────────────────────

	const currentVariant = $derived(VARIANTS.find((v) => v.id === variant) ?? VARIANTS[0]);
	const fps = $derived(Math.round(model.measuredFps));
	const altitudeFt = $derived(Math.round(model.flight.altitude));
	const nfPct = $derived(Math.round(model.nightFactor * 100));

	// Variant E readout: live altitudeBlend.
	const altitudeBlend = $derived.by(() => {
		if (variant !== 'E') return 0;
		const lo = tunablesE.lowAltitudeFt;
		const hi = tunablesE.highAltitudeFt;
		return clamp((model.flight.altitude - lo) / Math.max(hi - lo, 1), 0, 1);
	});

	onDestroy(() => {
		// Model cleanup is handled by createAeroWindow lifecycle.
	});

	// ─── Slider input helpers ─────────────────────────────────────────────────
	// RangeSlider passes back the raw input event; we read currentTarget.value.

	function onGlobalTime(e: Event & { currentTarget: HTMLInputElement }) {
		globals.timeOfDay = parseFloat(e.currentTarget.value);
	}
	function onGlobalAlt(e: Event & { currentTarget: HTMLInputElement }) {
		globals.altitude = parseFloat(e.currentTarget.value);
	}

	function setA<K extends keyof typeof tunablesA>(k: K) {
		return (e: Event & { currentTarget: HTMLInputElement }) => {
			tunablesA[k] = parseFloat(e.currentTarget.value) as (typeof tunablesA)[K];
		};
	}
	function setB<K extends keyof typeof tunablesB>(k: K) {
		return (e: Event & { currentTarget: HTMLInputElement }) => {
			tunablesB[k] = parseFloat(e.currentTarget.value) as (typeof tunablesB)[K];
		};
	}
	function setC<K extends keyof typeof tunablesC>(k: K) {
		return (e: Event & { currentTarget: HTMLInputElement }) => {
			tunablesC[k] = parseFloat(e.currentTarget.value) as (typeof tunablesC)[K];
		};
	}
	function setD<K extends keyof typeof tunablesD>(k: K) {
		return (e: Event & { currentTarget: HTMLInputElement }) => {
			tunablesD[k] = parseFloat(e.currentTarget.value) as (typeof tunablesD)[K];
		};
	}
	function setE<K extends keyof typeof tunablesE>(k: K) {
		return (e: Event & { currentTarget: HTMLInputElement }) => {
			tunablesE[k] = parseFloat(e.currentTarget.value) as (typeof tunablesE)[K];
		};
	}
</script>

<div class="lab">
	<div class="globe-pane">
		<CesiumViewer />
	</div>

	<aside class="panel" aria-label="Variant comparison">
		<header>
			<h2>Night Lab</h2>
			<p class="hint">Hyderabad · autopilot off · ultra quality</p>
		</header>

		<!-- ── Global controls ──────────────────────────────────────────── -->
		<fieldset class="globals">
			<legend>Global</legend>
			<RangeSlider
				label="Time of day"
				value={globals.timeOfDay}
				min={15.0}
				max={24.0}
				step={0.25}
				formatValue={(v) => `${v.toFixed(2)}h`}
				oninput={onGlobalTime}
			/>
			<RangeSlider
				label="Altitude"
				value={globals.altitude}
				min={10000}
				max={65000}
				step={500}
				formatValue={(v) => `${Math.round(v).toLocaleString()} ft`}
				oninput={onGlobalAlt}
			/>
		</fieldset>

		<!-- ── Variant picker ───────────────────────────────────────────── -->
		<fieldset class="variants" role="radiogroup" aria-label="Rendering variant">
			<legend>Variant</legend>
			{#each VARIANTS as v (v.id)}
				<label class="row">
					<input
						type="radio"
						name="variant"
						value={v.id}
						checked={variant === v.id}
						onchange={() => (variant = v.id)}
					/>
					<span class="row-label">
						<strong>{v.id}.</strong>
						{v.label}
					</span>
					<span class="row-hint">{v.hint}</span>
				</label>
			{/each}
		</fieldset>

		<!-- ── Variant-specific tunables ────────────────────────────────── -->
		<fieldset class="tunables">
			<legend>Variant {variant} tunables</legend>

			{#if variant === 'A'}
				<RangeSlider
					label="Bloom contrast"
					value={tunablesA.bloomContrast}
					min={32}
					max={256}
					step={1}
					formatValue={(v) => v.toFixed(0)}
					oninput={setA('bloomContrast')}
				/>
				<RangeSlider
					label="Bloom brightness"
					value={tunablesA.bloomBrightness}
					min={-1.0}
					max={1.0}
					step={0.05}
					formatValue={(v) => v.toFixed(2)}
					oninput={setA('bloomBrightness')}
				/>
				<RangeSlider
					label="Bloom sigma"
					value={tunablesA.bloomSigma}
					min={0.5}
					max={8.0}
					step={0.1}
					formatValue={(v) => v.toFixed(1)}
					oninput={setA('bloomSigma')}
				/>
				<RangeSlider
					label="Night light intensity"
					value={tunablesA.nightLightIntensity}
					min={0.0}
					max={2.0}
					step={0.05}
					formatValue={(v) => v.toFixed(2)}
					oninput={setA('nightLightIntensity')}
				/>
				<RangeSlider
					label="Base night brightness"
					value={tunablesA.baseNightBrightness}
					min={0.0}
					max={0.5}
					step={0.01}
					formatValue={(v) => v.toFixed(2)}
					oninput={setA('baseNightBrightness')}
				/>
				<RangeSlider
					label="Base night saturation"
					value={tunablesA.baseNightSaturation}
					min={0.0}
					max={0.5}
					step={0.01}
					formatValue={(v) => v.toFixed(2)}
					oninput={setA('baseNightSaturation')}
				/>
			{:else if variant === 'B'}
				<RangeSlider
					label="Luminance threshold"
					value={tunablesB.luminanceThreshold}
					min={0.0}
					max={1.0}
					step={0.05}
					formatValue={(v) => v.toFixed(2)}
					oninput={setB('luminanceThreshold')}
				/>
				<RangeSlider
					label="Bloom intensity"
					value={tunablesB.bloomIntensity}
					min={0.0}
					max={3.0}
					step={0.05}
					formatValue={(v) => v.toFixed(2)}
					oninput={setB('bloomIntensity')}
				/>
				<RangeSlider
					label="Tap radius"
					value={tunablesB.tapRadius}
					min={1}
					max={5}
					step={1}
					formatValue={(v) => v.toFixed(0)}
					oninput={setB('tapRadius')}
				/>
			{:else if variant === 'C'}
				<RangeSlider
					label="Sigma"
					value={tunablesC.sigma}
					min={1.0}
					max={8.0}
					step={0.1}
					formatValue={(v) => v.toFixed(1)}
					oninput={setC('sigma')}
				/>
				<RangeSlider
					label="Contrast"
					value={tunablesC.contrast}
					min={32}
					max={256}
					step={1}
					formatValue={(v) => v.toFixed(0)}
					oninput={setC('contrast')}
				/>
				<RangeSlider
					label="Brightness"
					value={tunablesC.brightness}
					min={-1.0}
					max={1.0}
					step={0.05}
					formatValue={(v) => v.toFixed(2)}
					oninput={setC('brightness')}
				/>
			{:else if variant === 'D'}
				<RangeSlider
					label="Emissive intensity"
					value={tunablesD.emissiveIntensity}
					min={0.0}
					max={1.5}
					step={0.05}
					formatValue={(v) => v.toFixed(2)}
					oninput={setD('emissiveIntensity')}
				/>
				<RangeSlider
					label="Emissive R"
					value={tunablesD.emissiveR}
					min={0}
					max={255}
					step={1}
					formatValue={(v) => v.toFixed(0)}
					oninput={setD('emissiveR')}
				/>
				<RangeSlider
					label="Emissive G"
					value={tunablesD.emissiveG}
					min={0}
					max={255}
					step={1}
					formatValue={(v) => v.toFixed(0)}
					oninput={setD('emissiveG')}
				/>
				<RangeSlider
					label="Emissive B"
					value={tunablesD.emissiveB}
					min={0}
					max={255}
					step={1}
					formatValue={(v) => v.toFixed(0)}
					oninput={setD('emissiveB')}
				/>
				<div class="swatch" style="background: rgb({tunablesD.emissiveR}, {tunablesD.emissiveG}, {tunablesD.emissiveB})">
					emissive preview
				</div>
			{:else if variant === 'E'}
				<RangeSlider
					label="Low altitude (ft)"
					value={tunablesE.lowAltitudeFt}
					min={5000}
					max={20000}
					step={500}
					formatValue={(v) => `${Math.round(v).toLocaleString()}`}
					oninput={setE('lowAltitudeFt')}
				/>
				<RangeSlider
					label="High altitude (ft)"
					value={tunablesE.highAltitudeFt}
					min={20000}
					max={40000}
					step={500}
					formatValue={(v) => `${Math.round(v).toLocaleString()}`}
					oninput={setE('highAltitudeFt')}
				/>
				<RangeSlider
					label="VIIRS dim min"
					value={tunablesE.viirsDimMin}
					min={0.0}
					max={1.0}
					step={0.05}
					formatValue={(v) => v.toFixed(2)}
					oninput={setE('viirsDimMin')}
				/>
				<RangeSlider
					label="Building emissive max"
					value={tunablesE.buildingEmissiveMax}
					min={0.0}
					max={1.5}
					step={0.05}
					formatValue={(v) => v.toFixed(2)}
					oninput={setE('buildingEmissiveMax')}
				/>
			{/if}

			<div class="reset-row">
				<button class="reset small" type="button" onclick={resetVariantDefaults}>
					Reset variant
				</button>
				<button class="reset small" type="button" onclick={resetAll}>Reset all</button>
			</div>
		</fieldset>

		<!-- ── Readouts ─────────────────────────────────────────────────── -->
		<div class="readout">
			<div><span class="k">FPS</span><span class="v">{fps || '–'}</span></div>
			<div><span class="k">Altitude</span><span class="v">{altitudeFt.toLocaleString()} ft</span></div>
			<div><span class="k">Time</span><span class="v">{globals.timeOfDay.toFixed(2)}h</span></div>
			<div><span class="k">Night factor</span><span class="v">{nfPct}%</span></div>
			<div><span class="k">Active</span><span class="v">{currentVariant.id}</span></div>
			{#if variant === 'E'}
				<div><span class="k">Alt blend</span><span class="v">{(altitudeBlend * 100).toFixed(0)}%</span></div>
			{/if}
		</div>

		<button class="reset" type="button" onclick={resetCamera}>Reset camera</button>

		<footer>
			<p class="note">
				Variants A–C: post-process. D–E: building emissive via Cesium3DTileStyle.
				Variant E uses <code>nightLightIntensity</code> to dim VIIRS at low altitude.
			</p>
		</footer>
	</aside>
</div>

<style>
	.lab {
		position: fixed;
		inset: 0;
		overflow: hidden;
		background: #04060d;
		color: #eee;
		font-family: system-ui, sans-serif;
	}
	.globe-pane {
		position: absolute;
		inset: 0;
	}

	.panel {
		position: absolute;
		top: 16px;
		left: 16px;
		width: 320px;
		max-height: calc(100vh - 32px);
		overflow-y: auto;
		background: rgba(10, 10, 15, 0.92);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 12px;
		padding: 16px;
		z-index: 30;
		backdrop-filter: blur(8px);
	}

	.panel header h2 {
		font-size: 14px;
		margin: 0 0 4px;
		color: #fff;
		letter-spacing: 0.5px;
	}
	.panel header .hint {
		margin: 0 0 12px;
		font-size: 10px;
		color: #888;
		text-transform: uppercase;
		letter-spacing: 1px;
	}

	fieldset {
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 10px;
		margin: 0 0 12px;
		padding: 8px 10px;
	}
	fieldset legend {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 1px;
		color: #666;
		padding: 0 6px;
	}

	.globals :global(.control),
	.tunables :global(.control) {
		margin-bottom: 8px;
	}

	.variants .row {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 8px;
		align-items: baseline;
		padding: 6px 4px;
		border-radius: 6px;
		cursor: pointer;
		transition: background 0.15s ease;
	}
	.variants .row:hover {
		background: rgba(255, 255, 255, 0.04);
	}
	.variants .row input[type='radio'] {
		grid-row: 1 / span 2;
		margin: 4px 0 0;
		accent-color: #7faeff;
	}
	.variants .row-label {
		font-size: 12px;
		color: #ddd;
	}
	.variants .row-label strong {
		color: #7faeff;
		font-family: ui-monospace, monospace;
		margin-right: 4px;
	}
	.variants .row-hint {
		grid-column: 2;
		font-size: 10px;
		color: #777;
		line-height: 1.4;
	}

	.swatch {
		margin-top: 8px;
		padding: 6px 8px;
		border-radius: 6px;
		font-size: 10px;
		color: rgba(0, 0, 0, 0.7);
		font-family: ui-monospace, monospace;
		letter-spacing: 0.5px;
		text-align: center;
	}

	.reset-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
		margin-top: 10px;
	}

	.readout {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px 12px;
		padding: 8px 10px;
		background: rgba(0, 0, 0, 0.25);
		border-radius: 8px;
		font-family: ui-monospace, monospace;
		font-size: 11px;
		margin-bottom: 12px;
	}
	.readout > div {
		display: flex;
		justify-content: space-between;
	}
	.readout .k {
		color: #666;
	}
	.readout .v {
		color: #7faeff;
	}

	.reset {
		display: block;
		width: 100%;
		padding: 8px;
		background: rgba(127, 174, 255, 0.12);
		border: 1px solid rgba(127, 174, 255, 0.3);
		border-radius: 6px;
		color: #cdddff;
		font-size: 12px;
		font-family: system-ui, sans-serif;
		cursor: pointer;
		transition: background 0.2s ease;
	}
	.reset:hover {
		background: rgba(127, 174, 255, 0.22);
	}
	.reset.small {
		padding: 6px;
		font-size: 11px;
	}

	footer {
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
	}
	footer .note {
		margin: 0;
		font-size: 10px;
		color: #666;
		line-height: 1.4;
	}
	footer code {
		font-family: ui-monospace, monospace;
		color: #888;
		background: rgba(255, 255, 255, 0.06);
		padding: 1px 4px;
		border-radius: 3px;
	}
</style>
