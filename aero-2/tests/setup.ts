/**
 * Vitest setup.
 *
 * `$app/env/public` is a SvelteKit virtual module. In dev mode its generated
 * form reads `globalThis.__sveltekit_dev`, which only exists inside a running
 * Kit app — so anything importing it (here, the tile templates) explodes on
 * import under a bare Vitest run. Kit populates this global itself at runtime;
 * we only stand in for it so modules can be imported outside the dev server.
 *
 * Values still come from `src/env.ts`: `PUBLIC_TILE_SERVER_URL` is `static`, so
 * its schema default is already inlined into the generated module and an empty
 * `env` here changes nothing about what the tests observe.
 */
declare global {
	// eslint-disable-next-line no-var
	var __sveltekit_dev: { env: Record<string, string> } | undefined;
}

globalThis.__sveltekit_dev = { env: {} };

export {};
