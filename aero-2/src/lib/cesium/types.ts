/**
 * Shapes both halves of render/ agree on. Leaf module by design: the sync
 * modules import it and the runtime imports them, so putting these next to
 * Scene would make that a cycle.
 */
import type { CameraPose } from '#lib/flight/model.js';
import type { AtmosphereState } from '#lib/world/atmosphere/rules.js';
import type { ImagerySelection } from '#lib/world/imagery/rules.js';

export type CesiumModule = typeof import('cesium');
export type Viewer = import('cesium').Viewer;
export type ImageryLayer = import('cesium').ImageryLayer;
export type CesiumScene = import('cesium').Scene;
export type ImageryMode = 'local' | 'ion' | 'none';

export class GlobeRuntime {
	constructor(
		readonly Cesium: CesiumModule,
		readonly viewer: Viewer,
		readonly ionToken?: string
	) {}
}

/**
 * The slice plus everything the world derives from it, resolved once per frame.
 *
 * Derived here rather than in the model so there is exactly one place these can
 * be computed, and no way for a stale copy to ride across the boundary.
 */
export class RenderFrame {
	constructor(
		readonly camera: CameraPose,
		readonly atmosphere: AtmosphereState,
		readonly imagery: ImagerySelection,
		readonly nightFactor: number
	) {}
}

/**
 * One shape for everything the runtime drives per frame.
 *
 * Uniform on purpose: Scene holds these in a list and walks it, so
 * adding a subsystem is one array entry rather than four edits (a field, a
 * setup call, a sync call, a reset call) that can each be forgotten
 * independently. Each subsystem takes the whole slice and reads the part it
 * cares about.
 */
export interface Subsystem {
	/** Async one-time init. Awaited in list order during open(). */
	setup?(rt: GlobeRuntime): Promise<void>;
	sync(rt: GlobeRuntime, frame: RenderFrame): void;
	reset?(): void;
}
