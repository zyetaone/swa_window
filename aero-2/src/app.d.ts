// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	interface ImportMetaEnv {
		readonly VITE_CESIUM_ION_TOKEN?: string;
		readonly VITE_TILE_SERVER_URL?: string;
	}

	/** Injected by vite.config.ts `define` — points at the copied Cesium assets. */
	const CESIUM_BASE_URL: string;
}

export {};
