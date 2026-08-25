import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CameraPose, FlightFrame } from '#lib/state/pose.js';
import { resolveAtmosphere } from '#lib/rules/atmosphere.js';
import { selectImagery } from '#lib/rules/imagery.js';
import { GlobeRuntime, RenderFrame } from '#lib/render/types.js';
import { tileCache } from '#lib/render/tiles.svelte.js';
import { worldRuntime } from '#lib/render/runtime.svelte.js';
import { configureScene, globe } from '#lib/render/attach.svelte.js';
import { AtmosphereSync } from '#lib/render/sync/atmosphere.js';
import { CameraSync } from '#lib/render/sync/camera.js';
import { ImagerySync } from '#lib/render/sync/imagery.svelte.js';
import { LightingSync } from '#lib/render/sync/lighting.js';
import { LodSync, screenSpaceErrorFor } from '#lib/render/sync/lod.js';
import { TerrainSync } from '#lib/render/sync/terrain.js';

function testSlice(overrides: { altitudeM?: number; timeOfDay?: number } = {}): FlightFrame {
	const altitudeM = overrides.altitudeM ?? 1000;
	return new FlightFrame(new CameraPose(0, 0, altitudeM, 0, -10), overrides.timeOfDay ?? 12);
}

function testFrame(overrides: { altitudeM?: number; nightFactor?: number } = {}): RenderFrame {
	const altitudeM = overrides.altitudeM ?? 1000;
	const nightFactor = overrides.nightFactor ?? 0;
	const atmosphere = resolveAtmosphere(altitudeM);
	return new RenderFrame(
		new CameraPose(0, 0, altitudeM, 0, -10),
		atmosphere,
		selectImagery({ groundDetail: atmosphere.groundDetail, nightFactor, current: null }),
		nightFactor,
	);
}

function fakeLodRuntime() {
	const globeObj = { maximumScreenSpaceError: 0 };
	return { rt: { viewer: { scene: { globe: globeObj } } } as unknown as GlobeRuntime, globe: globeObj };
}

function mockHealth(layers: string[]) {
	vi.mocked(fetch).mockResolvedValueOnce(
		new Response(JSON.stringify({ hasTiles: layers.length > 0, layers })),
	);
}

function mockImageryRuntime(addImageryProvider: ReturnType<typeof vi.fn>) {
	return {
		Cesium: {
			UrlTemplateImageryProvider: vi.fn(function (this: unknown, opts: unknown) {
				return opts;
			}),
			WebMercatorTilingScheme: vi.fn(function (this: unknown) {
				return {};
			}),
		},
		viewer: {
			imageryLayers: {
				removeAll: vi.fn(),
				remove: vi.fn(),
				addImageryProvider,
			},
		},
	} as unknown as GlobeRuntime;
}

describe('globe', () => {
	it('returns a Svelte attachment function', () => {
		expect(typeof globe()).toBe('function');
	});

	it('worldRuntime.sync is safe before mount', () => {
		expect(() => worldRuntime.sync(testSlice())).not.toThrow();
	});
});

describe('CameraSync', () => {
	it('sync is callable', () => {
		expect(typeof new CameraSync().sync).toBe('function');
	});
});

describe('configureScene', () => {
	it('disables the sky veil and hands fog to AtmosphereSync', () => {
		const globeObj = { showGroundAtmosphere: true, maximumScreenSpaceError: 0 };
		const fog = { enabled: true };
		const skyAtmosphere = { show: true };
		configureScene({ globe: globeObj, fog, skyAtmosphere } as never);
		expect(globeObj.showGroundAtmosphere).toBe(false);
		// Fog is ON and owned by AtmosphereSync, which sets density per band.
		expect(fog.enabled).toBe(true);
		expect(skyAtmosphere.show).toBe(false);
	});
});

describe('AtmosphereSync', () => {
	it('sets fog density and sky colour from the current band', () => {
		const sync = new AtmosphereSync();
		const low = resolveAtmosphere(300);
		const fog = { density: 0 };
		const scene = { fog, backgroundColor: null };
		const rt = {
			Cesium: {
				Color: vi.fn(function (this: unknown, r: number, g: number, b: number, a: number) {
					return { r, g, b, a };
				}),
			},
			viewer: { scene },
		} as unknown as GlobeRuntime;

		sync.sync(rt, testFrame({ altitudeM: 300 }));

		expect(fog.density).toBe(low.fogDensity);
		expect(rt.Cesium.Color).toHaveBeenCalledWith(low.skyTop[0], low.skyTop[1], low.skyTop[2], 1);
	});

	it('does not repaint for sub-threshold altitude drift', () => {
		const sync = new AtmosphereSync();
		const fog = { density: 0 };
		const scene = { fog, backgroundColor: null };
		const rt = {
			Cesium: {
				Color: vi.fn(function (this: unknown, r: number, g: number, b: number, a: number) {
					return { r, g, b, a };
				}),
			},
			viewer: { scene },
		} as unknown as GlobeRuntime;

		sync.sync(rt, testFrame({ altitudeM: 500 }));
		const first = fog.density;
		vi.mocked(rt.Cesium.Color).mockClear();
		sync.sync(rt, testFrame({ altitudeM: 510 }));
		expect(fog.density).toBe(first);
		expect(rt.Cesium.Color).not.toHaveBeenCalled();
	});

	it('repaints when crossing a band boundary', () => {
		const sync = new AtmosphereSync();
		const fog = { density: 0 };
		const scene = { fog, backgroundColor: null };
		const rt = {
			Cesium: {
				Color: vi.fn(function (this: unknown, r: number, g: number, b: number, a: number) {
					return { r, g, b, a };
				}),
			},
			viewer: { scene },
		} as unknown as GlobeRuntime;

		sync.sync(rt, testFrame({ altitudeM: 500 }));
		const lowDensity = fog.density;
		sync.sync(rt, testFrame({ altitudeM: 4000 }));
		expect(fog.density).not.toBe(lowDensity);
	});
});

describe('LodSync', () => {
	it('asks for finer tiles low down than at cruise', () => {
		const low = screenSpaceErrorFor(resolveAtmosphere(300).groundDetail);
		const high = screenSpaceErrorFor(resolveAtmosphere(11_600).groundDetail);
		expect(low).toBeLessThan(high);
	});

	it('does not retile for sub-threshold drift', () => {
		const { rt, globe: globeObj } = fakeLodRuntime();
		const sync = new LodSync();
		sync.sync(rt, testFrame({ altitudeM: 500 }));
		const first = globeObj.maximumScreenSpaceError;
		sync.sync(rt, testFrame({ altitudeM: 520 }));
		expect(globeObj.maximumScreenSpaceError).toBe(first);
	});
});

describe('LightingSync', () => {
	it('enables globe lighting at night', () => {
		const sync = new LightingSync();
		const scene = { globe: { enableLighting: false } };
		const rt = { viewer: { scene } } as unknown as GlobeRuntime;

		sync.sync(rt, testFrame({ nightFactor: 0 }));
		expect(scene.globe.enableLighting).toBe(false);

		sync.sync(rt, testFrame({ nightFactor: 1 }));
		expect(scene.globe.enableLighting).toBe(true);
	});
});

describe('ImagerySync', () => {
	beforeEach(() => {
		tileCache.reset();
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('adds local UrlTemplateImageryProvider on sync', async () => {
		mockHealth(['eox-sentinel2']);
		await tileCache.probe();

		const addImageryProvider = vi.fn((p: unknown) => ({ p }));
		const rt = mockImageryRuntime(addImageryProvider);
		const sync = new ImagerySync();
		await sync.setup(rt);

		sync.sync(rt, testFrame());

		expect(addImageryProvider).toHaveBeenCalledOnce();
	});

	it('gates cartodb to eox when night pack is absent', async () => {
		mockHealth(['eox-sentinel2']);
		await tileCache.probe();

		const addImageryProvider = vi.fn((p: unknown) => ({ p }));
		const rt = mockImageryRuntime(addImageryProvider);
		const sync = new ImagerySync();
		await sync.setup(rt);

		sync.sync(rt, testFrame({ nightFactor: 1 }));

		expect(rt.Cesium.UrlTemplateImageryProvider).toHaveBeenCalledWith(
			expect.objectContaining({
				url: '/api/tiles/eox-sentinel2/{z}/{y}/{x}.jpg',
			}),
		);
	});
});

describe('TerrainSync', () => {
	beforeEach(() => {
		tileCache.reset();
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('uses ellipsoid when no mesh pack', async () => {
		vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
		await tileCache.probe();

		const rt = {
			Cesium: {
				EllipsoidTerrainProvider: vi.fn(function (this: unknown) {
					return {};
				}),
			},
			viewer: { terrainProvider: null },
		} as unknown as GlobeRuntime;

		const sync = new TerrainSync();
		await sync.setup(rt);
		expect(sync.appliedMode).toBe('ellipsoid');
	});
});
