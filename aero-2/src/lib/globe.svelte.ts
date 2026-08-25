/**
 * Cesium globe — tile cache, viewer lifetime, per-frame sync, Svelte attachment.
 */
import type { Attachment } from 'svelte/attachments';
import { IMAGERY_SOURCES, SSE_CRUISE, SSE_GROUND } from '#lib/assets/data.js';
import type { CameraPose, GlobeSyncSlice } from '#lib/model.svelte.js';
import {
	gateImagerySelection,
	nightLighting,
	resolveAtmosphere,
	selectImagery,
	type AtmosphereState,
	type ImagerySelection,
} from '#lib/rules.js';
import { EpsilonGate } from '#lib/utils.js';

declare const CESIUM_BASE_URL: string;

type CesiumModule = typeof import('cesium');
type Viewer = import('cesium').Viewer;
type ImageryLayer = import('cesium').ImageryLayer;
type Scene = import('cesium').Scene;
type ImageryMode = 'local' | 'ion' | 'none';

const SSE_HYSTERESIS = 2;
const TILE_SERVER_DEFAULT = '/api/tiles';

// ── Tile cache ─────────────────────────────────────────────────────────────────

export function tileServerBase(): string {
	const url = import.meta.env.VITE_TILE_SERVER_URL;
	return typeof url === 'string' && url.length > 0 ? url.replace(/\/$/, '') : TILE_SERVER_DEFAULT;
}

export class TileCache {
	layers = $state<string[]>([]);
	probing = $state(false);

	hasTiles = $derived(this.layers.length > 0);

	layerAvailable(layerId: string): boolean {
		return this.layers.includes(layerId);
	}

	async probe(): Promise<void> {
		this.probing = true;
		const base = tileServerBase();
		try {
			const resp = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
			if (!resp.ok) {
				this.layers = [];
				return;
			}
			const body = (await resp.json().catch(() => null)) as {
				hasTiles?: boolean;
				layers?: unknown;
			} | null;
			const found = Array.isArray(body?.layers)
				? body.layers.filter((l): l is string => typeof l === 'string')
				: [];
			this.layers = body?.hasTiles === false ? [] : found;
		} catch {
			this.layers = [];
		} finally {
			this.probing = false;
		}
	}

	reset(): void {
		this.layers = [];
		this.probing = false;
	}
}

export const tileCache = new TileCache();

// ── Runtime handle ─────────────────────────────────────────────────────────────

export class GlobeRuntime {
	constructor(
		readonly Cesium: CesiumModule,
		readonly viewer: Viewer,
		readonly ionToken?: string,
	) {}
}

/**
 * The slice plus everything the world derives from it, resolved once per frame.
 *
 * Derived here rather than in the model so there is exactly one place these can
 * be computed, and no way for a stale copy to ride across the boundary.
 */
export class WorldFrame {
	constructor(
		readonly camera: CameraPose,
		readonly atmosphere: AtmosphereState,
		readonly imagery: ImagerySelection,
		readonly nightFactor: number,
	) {}
}

/**
 * One shape for everything the runtime drives per frame.
 *
 * Uniform on purpose: WorldRuntime holds these in a list and walks it, so
 * adding a subsystem is one array entry rather than four edits (a field, a
 * setup call, a sync call, a reset call) that can each be forgotten
 * independently. Each subsystem takes the whole slice and reads the part it
 * cares about.
 */
export interface Subsystem {
	/** Async one-time init. Awaited in list order during open(). */
	setup?(rt: GlobeRuntime): Promise<void>;
	sync(rt: GlobeRuntime, frame: WorldFrame): void;
	reset?(): void;
}

// ── Sync subsystems ────────────────────────────────────────────────────────────

export class CameraSync implements Subsystem {
	#scratch: import('cesium').Cartesian3 | null = null;

	sync(rt: GlobeRuntime, frame: WorldFrame): void {
		const { Cesium, viewer } = rt;
		const camera = frame.camera;
		this.#scratch ??= new Cesium.Cartesian3();
		Cesium.Cartesian3.fromDegrees(
			camera.lon,
			camera.lat,
			camera.altitudeM,
			Cesium.Ellipsoid.WGS84,
			this.#scratch,
		);
		viewer.camera.setView({
			destination: this.#scratch,
			orientation: {
				heading: Cesium.Math.toRadians(camera.headingDeg),
				pitch: Cesium.Math.toRadians(camera.pitchDeg),
				roll: 0,
			},
		});
	}

	reset(): void {
		this.#scratch = null;
	}
}

/** One-time scene defaults. AtmosphereSync drives fog and sky colour per frame. */
export function configureScene(scene: Scene): void {
	scene.globe.maximumScreenSpaceError = SSE_GROUND;
	scene.globe.showGroundAtmosphere = false;
	scene.fog.enabled = true;
	if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
}

/**
 * Paints the band the aircraft is currently in: fog thickens with altitude and
 * the sky darkens toward the stratosphere.
 *
 * Gated on altitude rather than on each colour channel — every field in the
 * atmosphere state is a function of altitude alone, so one gate covers them all
 * and the three panes cross each threshold on the same value, not the same frame.
 *
 * `deckOpacity` is deliberately unread: it wants an actual cloud deck to fade,
 * and there isn't one yet. Wiring it to fog would double-count the haze.
 */
export class AtmosphereSync implements Subsystem {
	readonly #gate = new EpsilonGate(25);

	sync(rt: GlobeRuntime, frame: WorldFrame): void {
		if (!this.#gate.changed(frame.camera.altitudeM)) return;
		const { scene } = rt.viewer;
		const a = frame.atmosphere;

		scene.fog.density = a.fogDensity;
		scene.backgroundColor = new rt.Cesium.Color(a.skyTop[0], a.skyTop[1], a.skyTop[2], 1);
	}

	reset(): void {
		this.#gate.reset();
	}
}

export function screenSpaceErrorFor(groundDetail: number): number {
	const g = Number.isFinite(groundDetail) ? Math.min(1, Math.max(0, groundDetail)) : 0;
	return SSE_CRUISE + (SSE_GROUND - SSE_CRUISE) * g;
}

export class LodSync implements Subsystem {
	readonly #gate = new EpsilonGate(SSE_HYSTERESIS);

	sync(rt: GlobeRuntime, frame: WorldFrame): void {
		const target = screenSpaceErrorFor(frame.atmosphere.groundDetail);
		if (!this.#gate.changed(target)) return;
		rt.viewer.scene.globe.maximumScreenSpaceError = target;
	}

	reset(): void {
		this.#gate.reset();
	}
}

export class LightingSync implements Subsystem {
	readonly #gate = new EpsilonGate(0.005);

	sync(rt: GlobeRuntime, frame: WorldFrame): void {
		const nightFactor = frame.nightFactor;
		if (!this.#gate.changed(nightFactor)) return;
		rt.viewer.scene.globe.enableLighting = nightFactor > 0.05;
	}

	reset(): void {
		this.#gate.reset();
	}
}

export class ImagerySync implements Subsystem {
	mode = $state<ImageryMode>('none');

	#layer: ImageryLayer | null = null;
	#applied: ImagerySelection | null = null;
	#ready = false;

	async setup(rt: GlobeRuntime): Promise<void> {
		rt.viewer.imageryLayers.removeAll();
		this.#layer = null;
		this.#applied = null;

		if (tileCache.hasTiles) {
			this.mode = 'local';
		} else if (rt.ionToken) {
			this.mode = 'ion';
			await this.#addIon(rt);
		} else {
			this.mode = 'none';
		}

		this.#ready = true;
	}

	sync(rt: GlobeRuntime, frame: WorldFrame): void {
		if (!this.#ready || this.mode !== 'local') return;

		const gated = gateImagerySelection(frame.imagery, (id) => tileCache.layerAvailable(id));
		if (sameImagery(this.#applied, gated)) return;

		if (this.#layer) {
			rt.viewer.imageryLayers.remove(this.#layer, true);
			this.#layer = null;
		}

		const source = IMAGERY_SOURCES.find((s) => s.id === gated.sourceId);
		const minimumLevel = source?.zoomRange[0] ?? 4;

		const provider = new rt.Cesium.UrlTemplateImageryProvider({
			url: this.#resolveUrl(gated.urlTemplate),
			maximumLevel: gated.maximumLevel,
			minimumLevel,
			tilingScheme: new rt.Cesium.WebMercatorTilingScheme(),
		});

		this.#layer = rt.viewer.imageryLayers.addImageryProvider(provider);
		this.#applied = gated;
	}

	reset(): void {
		this.#layer = null;
		this.#applied = null;
		this.#ready = false;
		this.mode = 'none';
	}

	async #addIon(rt: GlobeRuntime): Promise<void> {
		try {
			const provider = await rt.Cesium.IonImageryProvider.fromAssetId(2);
			this.#layer = rt.viewer.imageryLayers.addImageryProvider(provider);
		} catch (e) {
			console.warn('[ImagerySync] Ion fallback failed:', e);
			this.mode = 'none';
		}
	}

	#resolveUrl(template: string): string {
		const base = tileServerBase();
		if (template.startsWith('/api/tiles') && base !== '/api/tiles') {
			return template.replace('/api/tiles', base);
		}
		return template;
	}
}

function sameImagery(a: ImagerySelection | null, b: ImagerySelection): boolean {
	return (
		a !== null &&
		a.sourceId === b.sourceId &&
		a.urlTemplate === b.urlTemplate &&
		a.maximumLevel === b.maximumLevel
	);
}

export class TerrainSync implements Subsystem {
	appliedMode = $state<'ellipsoid' | 'mesh' | null>(null);
	#ready = false;

	async setup(rt: GlobeRuntime): Promise<void> {
		this.appliedMode = null;
		this.#ready = true;
		await this.#apply(rt);
	}

	sync(rt: GlobeRuntime, _frame: WorldFrame): void {
		if (!this.#ready) return;
		// Cheap guard before the async call — otherwise this allocates a promise
		// 60x a second only to early-return inside it.
		const target = tileCache.layerAvailable('cesium-terrain') ? 'mesh' : 'ellipsoid';
		if (this.appliedMode === target) return;
		void this.#apply(rt);
	}

	reset(): void {
		this.appliedMode = null;
		this.#ready = false;
	}

	async #apply(rt: GlobeRuntime): Promise<void> {
		const wantMesh = tileCache.layerAvailable('cesium-terrain');
		const targetMode: 'ellipsoid' | 'mesh' = wantMesh ? 'mesh' : 'ellipsoid';
		if (this.appliedMode === targetMode) return;

		if (targetMode === 'mesh') {
			try {
				rt.viewer.terrainProvider = await rt.Cesium.CesiumTerrainProvider.fromUrl(
					`${tileServerBase()}/cesium-terrain`,
				);
				this.appliedMode = 'mesh';
				return;
			} catch (e) {
				console.warn('[TerrainSync] local mesh failed, using ellipsoid:', e);
			}
		}

		rt.viewer.terrainProvider = new rt.Cesium.EllipsoidTerrainProvider();
		this.appliedMode = 'ellipsoid';
	}
}

// ── Orchestrator Runtime ───────────────────────────────────────────────────────

export class WorldRuntime {
	opened = $state(false);

	readonly #imagery = new ImagerySync();
	readonly #subsystems: readonly Subsystem[] = [
		new CameraSync(),
		new AtmosphereSync(),
		new LodSync(),
		this.#imagery,
		new TerrainSync(),
		new LightingSync(),
	];

	#runtime: GlobeRuntime | null = null;
	#imagerySelection: ImagerySelection | null = null;

	/** Read through to the subsystem rather than mirroring its state per frame. */
	get imageryMode(): ImageryMode {
		return this.#imagery.mode;
	}

	async open(Cesium: CesiumModule, viewer: Viewer, ionToken?: string): Promise<void> {
		const rt = new GlobeRuntime(Cesium, viewer, ionToken);
		this.#runtime = rt;
		if (import.meta.env.DEV) {
			(globalThis as Record<string, unknown>).__viewer = viewer;
		}

		await tileCache.probe();
		for (const s of this.#subsystems) await s.setup?.(rt);

		this.opened = true;
	}

	close(): void {
		this.#runtime = null;
		this.#imagerySelection = null;
		for (const s of this.#subsystems) s.reset?.();
		tileCache.reset();
		this.opened = false;
	}

	/**
	 * Push one frame. Safe before open() — the model ticks before the viewer
	 * exists, and again right after open() to fill the gap before the next RAF.
	 */
	sync(slice: GlobeSyncSlice): void {
		const rt = this.#runtime;
		if (!rt) return;
		for (const s of this.#subsystems) s.sync(rt, this.#resolve(slice));
	}

	/** Derive once per frame. Imagery is stateful — it holds its own last pick. */
	#resolve(slice: GlobeSyncSlice): WorldFrame {
		const atmosphere = resolveAtmosphere(slice.camera.altitudeM);
		const nightFactor = nightLighting.factor(slice.timeOfDay);
		this.#imagerySelection = selectImagery({
			groundDetail: atmosphere.groundDetail,
			nightFactor,
			current: this.#imagerySelection,
		});
		return new WorldFrame(slice.camera, atmosphere, this.#imagerySelection, nightFactor);
	}
}

export const worldRuntime = new WorldRuntime();

// ── Svelte attachment ──────────────────────────────────────────────────────────

function ensureCesiumBaseUrl(): void {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(globalThis as any).CESIUM_BASE_URL ??= CESIUM_BASE_URL;
}

const KIOSK_WIDGETS_OFF = {
	animation: false,
	baseLayerPicker: false,
	fullscreenButton: false,
	geocoder: false,
	homeButton: false,
	infoBox: false,
	navigationHelpButton: false,
	sceneModePicker: false,
	selectionIndicator: false,
	timeline: false,
} as const;

export function globe(token?: string, onReady?: () => void): Attachment<HTMLElement> {
	return (element) => {
		ensureCesiumBaseUrl();

		let viewer: Viewer | null = null;
		let cancelled = false;

		void (async () => {
			const Cesium = await import('cesium');
			if (cancelled) return;

			if (token) Cesium.Ion.defaultAccessToken = token;

			viewer = new Cesium.Viewer(element, {
				...KIOSK_WIDGETS_OFF,
				baseLayer: false,
				skyBox: false,
				skyAtmosphere: false,
				terrainProvider: new Cesium.EllipsoidTerrainProvider(),
			});
			viewer.cesiumWidget.creditContainer.remove();

			configureScene(viewer.scene);
			await worldRuntime.open(Cesium, viewer, token);
			onReady?.();
		})();

		return () => {
			cancelled = true;
			worldRuntime.close();
			viewer?.destroy();
			viewer = null;
		};
	};
}
