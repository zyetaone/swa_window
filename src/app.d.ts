// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	/** Build-time commit stamp injected by vite.config.ts `define`.
	 *  Read via $lib/version (which adds a safe 'dev' fallback) — do not
	 *  reference this directly outside that module. */
	const __APP_COMMIT__: string;

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
