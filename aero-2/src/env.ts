import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * Environment variables that reach the BROWSER, declared once.
 *
 * SvelteKit 3 replaces `$env/static/public` and a hand-written `ImportMetaEnv`
 * interface with this: the schema below is the type, the validation and the
 * hover documentation, so a malformed value cannot reach a fielded kiosk as a
 * blank window three layers away.
 *
 * The SERVER-side variables (`TILE_DIR`, `AERO_TILE_REMOTE_FALLBACK`) are
 * deliberately NOT here. `lib/server/tiles.ts` takes `env` as an injected
 * parameter, which is what lets `tests/server/tiles.test.ts` assert the
 * fail-closed behaviour directly — including the `NODE_ENV` fallback, which no
 * declarative schema can express. Injection is the better tool for that job.
 */
export const variables = defineEnvVars({
	PUBLIC_TILE_SERVER_URL: {
		public: true,
		// Inlined at build time: the kiosk gets a constant, not a runtime lookup.
		static: true,
		description: 'Client tile base URL. Trailing slash stripped. Default: /api/tiles',
		schema: (value) => value?.replace(/\/$/, '') || '/api/tiles'
	}
});
