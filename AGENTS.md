# AGENTS.md

> Guidance for AI coding agents working in this repository.

## Project Summary

Circadian-aware airplane window display for office wellbeing. Renders realistic window views using **Cesium** (terrain/imagery) with **CSS/WebGL overlay layers**, synced to real time of day. Built with **SvelteKit 2 + Svelte 5 runes**, targeting Raspberry Pi kiosk deployment.

## Commands

```bash
npm run dev            # Vite dev server (--host enabled)
npm run build          # Production build
npm run preview        # Preview production build
npm run check          # Type-check with svelte-check (strict)
npm run check:watch    # Type-check in watch mode
```

- **No test runner** is configured. No linter or formatter is configured.
- `npm run check` is the primary validation command — run it after any code change.
- SSR is disabled (`src/routes/+page.ts` exports `ssr = false`).

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | SvelteKit 2, Svelte 5 (runes: `$state`, `$derived`, `$effect`) |
| Terrain | Cesium (ESRI imagery, NASA VIIRS night lights, CartoDB roads) |
| Clouds | Three.js via @threlte/core + @threlte/extras (WebGL canvas) |
| Build | Vite 7, vite-plugin-static-copy (Cesium assets → `/cesiumStatic`) |
| Types | TypeScript strict mode (all strict flags + `noUnusedLocals/Parameters`) |
| Styling | Component-scoped `<style>` blocks. No Tailwind config. |

## Architecture

### File Structure

```
src/lib/core/          — Simulation state, types, constants, locations, persistence
src/lib/layers/        — Visual layer components (Window, Cesium, Clouds, Controls)
src/lib/layers/controls/ — UI sub-components (RangeSlider, Toggle)
src/routes/            — SvelteKit pages (+page.svelte is the app entry)
src/routes/architecture/ — Interactive architecture visualization page
```

### Core Modules

- **`WindowModel.svelte.ts`** (~816 lines): Single source of truth. All simulation state (`$state` fields), derived computations (`$derived`), and `tick*()` methods.
- **`index.ts`**: Barrel exports + context provider (`createAppState` / `useAppState`).
- **`constants.ts`**: All tuning values in `as const` objects: `AIRCRAFT`, `FLIGHT_FEEL`, `MICRO_EVENTS`, `AMBIENT`, `CESIUM`, `WEATHER_EFFECTS`.
- **`types.ts`**: Core type aliases (`SkyState`, `LocationId`, `WeatherType`) and `Location` interface.
- **`locations.ts`**: Location definitions with `LOCATION_MAP` (Map for O(1) lookups) and `LOCATION_IDS` (Set).
- **`persistence.ts`**: localStorage save/load with defensive validation (`safeNum`, type guards).

### State Flow

```
+page.svelte → createAppState() → WindowModel (set in Svelte context)
  ├── Window.svelte      (RAF tick loop, CSS layer compositor, local $derived for presentation)
  │   └── CesiumViewer   (terrain, imagery, post-processing shaders)
  ├── Controls.svelte    (HUD overlay / branding)
  └── SidePanel.svelte   (settings: location, sliders, weather)
```

### Key Patterns

- **Context state**: `createAppState()` in root only; `useAppState()` in descendants.
- **Derived value split**: Simulation-level `$derived` in WindowModel. Presentation-level `$derived` (CSS strings, pixels) local in Window.svelte.
- **User override**: `onUserInteraction(type)` pauses auto-behavior for 8 seconds.
- **Flight state machine**: `orbit → cruise_departure → cruise_transit → orbit`.
- **HMR cache**: `globalThis.__CESIUM_HMR_CACHE__` persists Cesium viewer across Vite hot reloads.
- **Attach directive**: `{@attach}` for imperative DOM setup (Cesium, Three.js).

## Code Style

### CRITICAL: Variable Naming with `$state`

**Never name a variable `state` when using the `$state` rune.** This causes a Svelte compiler error.

```typescript
// BAD — compiler error
const state = useAppState();
let x = $state(0);

// GOOD
const model = useAppState();
let x = $state(0);
```

### Imports

- **Named imports only** — no default imports from internal modules.
- **Path alias**: `$lib/core` for core modules (resolved by SvelteKit).
- **Relative imports** for sibling files within the same directory.
- **Ordering**: Svelte imports → external packages → `$lib/` imports → relative imports.
- **Type imports**: Use `import type { ... }` for type-only imports.
- **Re-exports**: Barrel pattern in `index.ts` with `export type { ... } from` and `export { ... } from`.

### TypeScript

- **Strict mode** with all strict flags enabled.
- `noUnusedLocals` and `noUnusedParameters` are enforced — no dead code.
- Use `type` for unions/aliases (`type SkyState = 'day' | 'night' | ...`).
- Use `interface` for object shapes (`interface Location { ... }`, `interface Props { ... }`).
- Component props use `interface Props` with `let { prop1, prop2 }: Props = $props()`.
- Prefer `Number.isFinite()` for numeric validation over truthiness checks.
- Use `as const` on constant object literals for narrowed types.

### Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Files (modules) | kebab-case | `flight-scenarios.ts`, `cesium-shaders.ts` |
| Files (components) | PascalCase | `WindowModel.svelte.ts`, `CesiumViewer.svelte` |
| Constants | SCREAMING_SNAKE_CASE | `AIRCRAFT`, `FLIGHT_FEEL`, `STORAGE_KEY` |
| Types/Interfaces | PascalCase | `SkyState`, `WeatherEffect`, `PersistedState` |
| Functions | camelCase | `clamp()`, `formatTime()`, `loadPersistedState()` |
| Variables | camelCase | `nightFactor`, `cloudDensity`, `isTransitioning` |
| Context keys | Symbol | `Symbol('APP_STATE')` |

### Formatting

- **Tabs** for indentation (see `.editorconfig` implicit from tsconfig/package.json).
- **Single quotes** for strings in TypeScript.
- **Double quotes** in string literals where readability helps (e.g., `"PM"`).
- **Trailing commas** on multi-line object/array literals.
- **Semicolons** at end of statements.
- **Section separators**: `// ====...====` comment blocks with section titles in constants files.

### Comments

- **JSDoc `/** */`** for exported functions and module headers.
- **Inline `//`** for implementation notes and clarifications.
- **No redundant comments** — code should be self-documenting where possible.
- Comments on `catch {}` blocks to explain silent failures (e.g., `// Storage full or blocked`).

### Error Handling

- **Silent catches** for non-critical paths: `try { ... } catch { }` (no error param).
- **Guard clauses** with early returns for browser-only code: `if (typeof window === 'undefined') return`.
- **Defensive validation** on external data (localStorage, URL params) using helper functions like `safeNum()`.
- **Throw errors** for programming mistakes: `throw new Error('useAppState() called outside component tree')`.
- **No unhandled promise rejections** — async functions in Cesium init use AbortController for cleanup.

### Svelte Component Patterns

- Props via `$props()` rune with typed destructuring.
- State via `$state()` for mutable reactive values.
- Computations via `$derived` (simple) or `$derived.by(() => ...)` (complex).
- Side effects via `$effect(() => { ... })` in components, not in models.
- DOM binding via `{@attach fn}` for imperative setup (preferred over `bind:this` + `onMount`).
- `onDestroy` or `$effect` return for cleanup.

## SvelteKit Remote Functions (Experimental)

Remote functions provide type-safe client-server communication. They run on the server but can be called from anywhere in the app. Requires SvelteKit 2.27+ and opt-in config:

```js
// svelte.config.js
kit: { experimental: { remoteFunctions: true } },
compilerOptions: { experimental: { async: true } }
```

### File Convention

Export remote functions from `.remote.ts` files placed anywhere in `src/` (except `src/lib/server/`). On the client, exports become `fetch` wrappers that call generated HTTP endpoints.

### Four Flavours

| Function | Purpose | Import from |
|----------|---------|-------------|
| `query` | Read dynamic data (cached while on page) | `$app/server` |
| `query.batch` | Batched reads (solves n+1 problem) | `$app/server` |
| `form` | Write data via `<form>` (works without JS) | `$app/server` |
| `command` | Write data imperatively (event handlers) | `$app/server` |
| `prerender` | Read static data (built at build time) | `$app/server` |

### Query Pattern

```ts
// src/routes/data.remote.ts
import * as v from 'valibot';
import { query } from '$app/server';

export const getItems = query(async () => { /* returns items */ });
export const getItem = query(v.string(), async (id) => { /* validated arg */ });
```

```svelte
<!-- Component: use with await -->
<script>
  import { getItems } from './data.remote';
</script>
{#each await getItems() as item}
  <p>{item.name}</p>
{/each}
```

- Queries are cached per-page: `getItems() === getItems()` (same reference).
- Refresh via `getItems().refresh()`.
- Arguments must be validated with a Standard Schema (Valibot/Zod).

### Form Pattern

```ts
// data.remote.ts
import * as v from 'valibot';
import { form } from '$app/server';

export const createItem = form(
  v.object({ name: v.pipe(v.string(), v.nonEmpty()) }),
  async ({ name }) => { /* insert into db, then redirect(...) or return result */ }
);
```

```svelte
<form {...createItem}>
  <input {...createItem.fields.name.as('text')} />
  <button>Create</button>
</form>
```

- Spread form onto `<form>` element — works without JS (progressive enhancement).
- Access field attrs via `.fields.fieldName.as('text' | 'number' | 'checkbox' | ...)`.
- Validation issues via `.fields.fieldName.issues()`.
- Client-side preflight: `createItem.preflight(schema)`.
- After submission, all queries refresh by default (or use single-flight mutations).

### Command Pattern

```ts
import { command } from '$app/server';

export const deleteItem = command(v.string(), async (id) => {
  await db.delete(id);
  getItems().refresh(); // explicitly refresh related queries
});
```

```svelte
<button onclick={() => deleteItem(item.id).updates(getItems())}>Delete</button>
```

- Commands cannot be called during render — only from event handlers.
- Unlike `form`, commands do NOT auto-refresh queries; use `.updates(...)` or call `.refresh()` inside the handler.
- Optimistic updates: `.updates(getItems().withOverride(fn))`.

### Key Rules

- **Always validate arguments** with Standard Schema when the function accepts input.
- **Use `getRequestEvent()`** inside remote functions to access cookies, params, url.
- **Sensitive form fields**: prefix name with `_` (e.g., `_password`) to prevent repopulation on reload.
- **Redirects**: use `redirect(...)` inside `query`, `form`, `prerender` — NOT inside `command`.
- **No `export` of schemas from `.remote.ts`** files; share schemas via separate modules.
- **`form.for(id)`** for repeated forms in lists (isolation per instance).

## SvelteKit Observability (Experimental)

Server-side OpenTelemetry tracing for SvelteKit. Requires SvelteKit 2.31+ and opt-in config:

```js
// svelte.config.js
kit: {
  experimental: {
    tracing: { server: true },
    instrumentation: { server: true }
  }
}
```

### What Gets Traced

- `handle` hook and `sequence` children
- Server `load` functions (and universal `load` on server)
- Form actions
- Remote functions

### Setup

1. Install dependencies:
   ```bash
   npm i @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-proto import-in-the-middle
   ```

2. Create `src/instrumentation.server.ts`:
   ```ts
   import { NodeSDK } from '@opentelemetry/sdk-node';
   import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
   import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
   import { createAddHookMessageChannel } from 'import-in-the-middle';
   import { register } from 'node:module';

   const { registerOptions } = createAddHookMessageChannel();
   register('import-in-the-middle/hook.mjs', import.meta.url, registerOptions);

   const sdk = new NodeSDK({
     serviceName: 'aero-window',
     traceExporter: new OTLPTraceExporter(),
     instrumentations: [getNodeAutoInstrumentations()]
   });
   sdk.start();
   ```

### Augmenting Spans

Access `root` and `current` spans on the request event to add custom attributes:

```ts
import { getRequestEvent } from '$app/server';

const event = getRequestEvent();
event.tracing.root.setAttribute('userId', user.id);
```

- `root` span = root `handle` function.
- `current` span = whichever context is active (`handle`, `load`, form action, or remote function).
- `@opentelemetry/api` is an optional peer dep — only install if collecting traces.
- Tracing has nontrivial overhead; consider enabling only in dev/preview environments.

## Environment Variables

Copy `.env.example` to `.env`:

```
VITE_CESIUM_ION_TOKEN=...       # Required — Cesium terrain/imagery
VITE_GOOGLE_MAPS_API_KEY=...    # Optional — Google 3D Tiles
```

**Never commit `.env` files.** Tokens are loaded at build time via Vite's `import.meta.env`.

## Build Notes

- Cesium static assets copied to `/cesiumStatic` via vite-plugin-static-copy.
- Manual chunks: `cesium` and `three` split into separate bundles.
- Chunk size warning limit: 5000KB (Cesium is large).
- `CESIUM_BASE_URL` defined globally via Vite's `define` config.
- CSP directives configured in `svelte.config.js` for Cesium's eval/worker needs.
