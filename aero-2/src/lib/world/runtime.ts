/** Module-private Cesium viewer handle. */

type CesiumModule = typeof import('cesium');
type Viewer = import('cesium').Viewer;

export class GlobeRuntime {
	constructor(
		readonly Cesium: CesiumModule,
		readonly viewer: Viewer,
	) {}
}

export class GlobeRuntimeHost {
	#runtime: GlobeRuntime | null = null;

	set(cesium: CesiumModule, viewer: Viewer): void {
		this.#runtime = new GlobeRuntime(cesium, viewer);
		if (import.meta.env.DEV) {
			(globalThis as Record<string, unknown>).__viewer = viewer;
		}
	}

	clear(): void {
		this.#runtime = null;
	}

	with(fn: (rt: GlobeRuntime) => void): void {
		if (!this.#runtime) return;
		fn(this.#runtime);
	}
}

export const globeRuntime = new GlobeRuntimeHost();
