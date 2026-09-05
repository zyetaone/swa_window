/**
 * App version — the build-time commit stamp.
 *
 * `__APP_COMMIT__` is injected by vite.config.ts `define` (git short sha, or
 * the APP_COMMIT env for tarball builds, or 'unknown'). The `typeof` guard
 * gives a 'dev' fallback anywhere the define isn't applied.
 *
 * ⚠ NEVER import this from server.ts — that file is run by Bun directly, not
 * built by Vite, so the define doesn't exist there (ReferenceError at boot).
 * Everything under src/ (including API routes) is Vite-built and safe.
 */
export const APP_COMMIT: string = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'dev';
