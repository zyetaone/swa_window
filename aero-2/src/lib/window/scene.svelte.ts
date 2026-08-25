/**
 * THE composition point. Everything else in this codebase is a part; this is
 * where the parts are named, ordered, and driven.
 *
 * `Scene` itself is mechanism — it walks whatever list it is given. The list at
 * the bottom of this file is the policy: what is in this world, in the order it
 * is applied to the globe.
 */
import type { CesiumModule, ImageryMode, Viewer } from '#lib/cesium/types.js';
import { GlobeRuntime, RenderFrame, type Subsystem } from '#lib/cesium/types.js';
import type { FlightFrame } from '#lib/flight/pose.js';
import { resolveAtmosphere } from '#lib/atmosphere/rules.js';
import { selectImagery, type ImagerySelection } from '#lib/imagery/rules.js';
import { nightLighting } from '#lib/lighting/rules.js';
import { tileCache } from '#lib/cesium/tiles.svelte.js';
import { AtmosphereSync } from '#lib/atmosphere/sync.js';
import { CameraSync } from '#lib/flight/sync.js';
import { ImagerySync } from '#lib/imagery/sync.svelte.js';
import { LightingSync } from '#lib/lighting/sync.js';
import { LodSync } from '#lib/terrain/sync.js';
import { TerrainSync } from '#lib/terrain/sync.js';

export class Scene {
	opened = $state(false);

	#runtime: GlobeRuntime | null = null;
	#imagerySelection: ImagerySelection | null = null;

	readonly #imagery: ImagerySync;

	constructor(
		readonly subsystems: readonly Subsystem[],
		imagery: ImagerySync,
	) {
		this.#imagery = imagery;
	}

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
		for (const s of this.subsystems) await s.setup?.(rt);

		this.opened = true;
	}

	close(): void {
		this.#runtime = null;
		this.#imagerySelection = null;
		for (const s of this.subsystems) s.reset?.();
		tileCache.reset();
		this.opened = false;
	}

	/**
	 * Push one frame. Safe before open() — the model ticks before the viewer
	 * exists, and again right after open() to fill the gap before the next RAF.
	 */
	sync(slice: FlightFrame): void {
		const rt = this.#runtime;
		if (!rt) return;
		for (const s of this.subsystems) s.sync(rt, this.#resolve(slice));
	}

	/** Derive once per frame. Imagery is stateful — it holds its own last pick. */
	#resolve(slice: FlightFrame): RenderFrame {
		const atmosphere = resolveAtmosphere(slice.camera.altitudeM);
		const nightFactor = nightLighting.factor(slice.timeOfDay);
		this.#imagerySelection = selectImagery({
			groundDetail: atmosphere.groundDetail,
			nightFactor,
			current: this.#imagerySelection,
		});
		return new RenderFrame(slice.camera, atmosphere, this.#imagerySelection, nightFactor);
	}
}

// ── The composition ──────────────────────────────────────────────────────────
// Order matters: camera first (everything else reads the pose it just set),
// lighting last (it reads the night factor the frame carries).
const imagery = new ImagerySync();

export const scene = new Scene(
	[
		new CameraSync(),
		new AtmosphereSync(),
		new LodSync(),
		imagery,
		new TerrainSync(),
		new LightingSync(),
	],
	imagery,
);
