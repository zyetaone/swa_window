/**
 * Owns the viewer's lifetime and walks the subsystem list once per frame.
 */
import type { CesiumModule, ImageryMode, Viewer } from '#lib/render/types.js';
import { GlobeRuntime, RenderFrame, type Subsystem } from '#lib/render/types.js';
import type { FlightFrame } from '#lib/state/pose.js';
import { resolveAtmosphere } from '#lib/rules/atmosphere.js';
import { selectImagery, type ImagerySelection } from '#lib/rules/imagery.js';
import { nightLighting } from '#lib/rules/lighting.js';
import { tileCache } from '#lib/render/tiles.svelte.js';
import { AtmosphereSync } from '#lib/render/sync/atmosphere.js';
import { CameraSync } from '#lib/render/sync/camera.js';
import { ImagerySync } from '#lib/render/sync/imagery.svelte.js';
import { LightingSync } from '#lib/render/sync/lighting.js';
import { LodSync } from '#lib/render/sync/lod.js';
import { TerrainSync } from '#lib/render/sync/terrain.js';

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
	sync(slice: FlightFrame): void {
		const rt = this.#runtime;
		if (!rt) return;
		for (const s of this.#subsystems) s.sync(rt, this.#resolve(slice));
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

export const worldRuntime = new WorldRuntime();
