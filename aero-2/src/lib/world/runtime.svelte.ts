/**
 * Owns the viewer's lifetime and walks the subsystem list once per frame.
 */
import type { CesiumModule, ImageryMode, Viewer } from '#lib/world/contract.js';
import { GlobeRuntime, WorldFrame, type Subsystem } from '#lib/world/contract.js';
import type { GlobeSyncSlice } from '#lib/sim/frame.js';
import {
	nightLighting,
	resolveAtmosphere,
	selectImagery,
	type ImagerySelection,
} from '#lib/rules.js';
import { tileCache } from '#lib/world/tiles.svelte.js';
import { AtmosphereSync } from '#lib/world/sync/atmosphere.js';
import { CameraSync } from '#lib/world/sync/camera.js';
import { ImagerySync } from '#lib/world/sync/imagery.svelte.js';
import { LightingSync } from '#lib/world/sync/lighting.js';
import { LodSync } from '#lib/world/sync/lod.js';
import { TerrainSync } from '#lib/world/sync/terrain.js';

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
