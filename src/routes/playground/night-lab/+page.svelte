<script lang="ts">
	/**
	 * /playground/night-lab — visual A/B comparison harness for night-light
	 * rendering variants.
	 *
	 * Camera is pinned over Hyderabad at 22:00, autopilot off, full-bleed.
	 * Toggle through five variants live to compare bloom + emissive strategies
	 * against the production baseline. No shell, no fleet, no commit.
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
	import { clamp, smoothstep } from '$lib/utils';

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

	// Reset camera helper — re-pins to defaults if it drifts (orbit still runs).
	function resetCamera(): void {
		model.setLocation('hyderabad');
		model.flight.altitude = 28000;
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
			// of any prior variant).
		}

		if (v === 'B') {
			// Disable Cesium built-in bloom; add additive custom bloom AFTER aero-color-grade.
			if (bloom) bloom.enabled = false;

			const FS_BLOOM_AFTER_GRADE = `
				uniform sampler2D colorTexture;
				uniform float u_nightFactor;
				in vec2 v_textureCoordinates;

				void main() {
					vec2 uv = v_textureCoordinates;
					vec4 base = texture(colorTexture, uv);
					vec2 px = vec2(1.0) / vec2(textureSize(colorTexture, 0));

					// 9-tap star pattern at ±1, ±2, ±3 pixels along both axes.
					vec3 acc = vec3(0.0);
					float wsum = 0.0;
					float offsets[3] = float[3](1.0, 2.0, 3.0);
					float weights[3] = float[3](0.4, 0.25, 0.12);
					for (int i = 0; i < 3; ++i) {
						float o = offsets[i];
						float w = weights[i];
						vec3 sH1 = texture(colorTexture, uv + vec2( o, 0.0) * px).rgb;
						vec3 sH2 = texture(colorTexture, uv + vec2(-o, 0.0) * px).rgb;
						vec3 sV1 = texture(colorTexture, uv + vec2(0.0,  o) * px).rgb;
						vec3 sV2 = texture(colorTexture, uv + vec2(0.0, -o) * px).rgb;
						acc += w * (sH1 + sH2 + sV1 + sV2);
						wsum += 4.0 * w;
					}
					vec3 blur = acc / max(wsum, 0.001);

					// Threshold: luminance > 0.5 contributes.
					float lum = dot(blur, vec3(0.2126, 0.7152, 0.0722));
					float thresh = smoothstep(0.5, 0.8, lum);
					vec3 bloomColor = blur * thresh;

					vec3 outRgb = base.rgb + bloomColor * 0.9 * u_nightFactor;
					out_FragColor = vec4(outRgb, base.a);
				}
			`;
			try {
				const stage = new Cesium.PostProcessStage({
					name: 'night-lab-bloom-after-grade',
					fragmentShader: FS_BLOOM_AFTER_GRADE,
					uniforms: {
						u_nightFactor: () => model.nightFactor,
					},
				});
				viewer.scene.postProcessStages.add(stage);
				addedStages.push(stage);
			} catch (e) {
				console.warn('[night-lab] variant B stage failed:', e);
			}
		}

		if (v === 'C') {
			// Wider Gaussian — softer broader halos.
			if (bloom) {
				bloom.enabled = true;
				if (bloom.uniforms) {
					bloom.uniforms.sigma = 4.5;
					bloom.uniforms.contrast = 96;
				}
			}
		}

		if (v === 'D' || v === 'E') {
			// Building emissive — flat (D) or altitude-aware (E).
			if (tileset) {
				(tileset as { colorBlendMode?: unknown }).colorBlendMode =
					Cesium.Cesium3DTileColorBlendMode.HIGHLIGHT;

				const updateStyle = () => {
					const nf = model.nightFactor;
					let emissiveAlpha: number;
					if (v === 'D') {
						emissiveAlpha = 0.6 * nf;
					} else {
						const altBlend = clamp(
							smoothstep((model.flight.altitude - 15000) / 10000),
							0,
							1,
						);
						emissiveAlpha = 0.6 * nf * (1 - altBlend);
					}
					(tileset as { style?: unknown }).style = new Cesium.Cesium3DTileStyle({
						color: `color("rgb(255, 180, 90)", ${emissiveAlpha.toFixed(3)})`,
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
				// Dim VIIRS at low altitude (alt × VIIRS, building × (1-alt)).
				// We cannot easily reach viirsLayer (private). Instead, scale
				// model.config.world.nightLightIntensity which CesiumManager
				// reads as `nightLightScale` → multiplies VIIRS alpha. Save
				// + restore the user's prior value.
				const priorIntensity = model.config.world.nightLightIntensity;
				const updateNightIntensity = () => {
					const altBlend = clamp(
						smoothstep((model.flight.altitude - 15000) / 10000),
						0,
						1,
					);
					// VIIRS alpha × lerp(0.3, 1.0, altBlend) — feed through nightLightIntensity.
					const target = 0.3 + 0.7 * altBlend;
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

	onDestroy(() => {
		// Model cleanup is handled by createAeroWindow lifecycle.
	});
</script>

<div class="lab">
	<div class="globe-pane">
		<CesiumViewer />
	</div>

	<aside class="panel" aria-label="Variant comparison">
		<header>
			<h2>Night Lab</h2>
			<p class="hint">Hyderabad · 22:00 · autopilot off · ultra quality</p>
		</header>

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

		<div class="readout">
			<div><span class="k">FPS</span><span class="v">{fps || '–'}</span></div>
			<div><span class="k">Altitude</span><span class="v">{altitudeFt.toLocaleString()} ft</span></div>
			<div><span class="k">Night factor</span><span class="v">{nfPct}%</span></div>
			<div><span class="k">Active</span><span class="v">{currentVariant.id}</span></div>
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
