// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	/** Injected by vite.config.ts `define` — points at the copied Cesium assets. */
	const CESIUM_BASE_URL: string;
	/** Build-time commit stamp, surfaced fleet-wide via /api/status. */
	const __APP_COMMIT__: string;
}

export {};
