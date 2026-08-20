# Security Boundary Map

**Verified against source: 2026-08-20** (previous revision: 2026-04-14)

> **No line numbers in this file, deliberately.** The 2026-04-14 revision
> anchored every row on `file:line`. Within one refactor cycle every anchor
> pointed at unrelated code — `?location=` was cited at `+page.svelte:64-68`,
> which by August was the persistence debounce `$effect`. Anchor on file +
> exported symbol; those survive edits, line numbers do not.
>
> That revision also described a **WebSocket** fleet (`fleet-hub.ts`, WS
> `set_scene`, `?server=` → `new WebSocket()`). That architecture was replaced
> by SSE; there is now no `WebSocket` constructor anywhere in `src/`. Of the two
> Criticals it listed, one is obsolete and one is re-classified as accepted
> operator behaviour whose mechanism is still live — and it kept asserting
> both as open for four months. **A stale security doc is worse than none
> — it reads authoritative in both directions.** Re-verify before trusting.

## Trust Boundaries

### Data Entry Points

| Entry Point | Source | Handler | Validated? |
|---|---|---|---|
| `?location=` URL param | Browser | `+page.svelte` search-param block | Yes — lowercased, then `isValidLocation()` (`LOCATION_IDS` Set membership) |
| `?weather=` URL param | Browser | `+page.svelte` search-param block | Yes — lowercased, then `isValidWeather()` |
| `?altitude=` URL param | Browser | `+page.svelte` search-param block | Yes — `Number.isFinite`, then **clamped** by `setAltitude` to `camera.altitude.min/max`. Clamp-at-bound is deliberate: the old range check silently dropped out-of-range values, which read as "param broken" during A/Bs. |
| `?time=` / `?overlay=` / `?hashpalette=` / `?lab=` | Browser | `+page.svelte` search-param block | Yes — numeric parse or flag test; unparseable values ignored |
| `?device=` URL param | Browser/attacker | `fleet/device-id.ts` → `resolveDeviceId()` | **Accepted risk** — deliberate operator field-assignment; overwriting a *different* stored id logs `console.warn`. Unbounded length. |
| SSE `set_config` | Fleet bus | `fleet/client.svelte.ts` → `applyConfigPatch()` | Yes — per-path allowlist + clamps (`model/peer-sync-paths.ts`) |
| SSE `set_scene` / `set_mode` | Fleet bus | `fleet/client.svelte.ts` | Yes — location via `LOCATION_IDS`, weather + mode via enum allowlist; media URL via `validateMediaUrl` |
| SSE `director_decision` / `vantage_beat` / `scene_resync` | Leader pane | `fleet/client.svelte.ts` | Shape-checked at handler; unknown types ignored |
| localStorage | Browser storage | `model/persistence.ts` → `loadPersistedState()` | Yes — type checks, enum allowlists, numeric bounds; refuses rather than coerces |
| `POST /api/command` body | Any HTTP client | `http/publish-route.ts` | Bearer-gated + 4 KB cap; **payload shape beyond `type: string` is not validated** (browser ignores unknown types) |
| `PATCH /api/config` body | Any HTTP client | `http/publish-route.ts` | Bearer-gated + 4 KB cap + namespace allowlist (prototype-pollution guard) |
| `?deviceId=` on `GET /api/fleet/heartbeat` | Any HTTP client | `fleet/heartbeat/+server.ts` | Yes — `DEVICE_ID_PATTERN` test, 400 on mismatch |
| `/api/tiles/*` path segments | Any HTTP client | `server/fs-guard.ts` → `safeResolveWithin()` | Yes — prefix check with trailing slash + `realpath` on both sides (symlink escape) |
| `/api/bundle/:hash` path | Any HTTP client | same `safeResolveWithin()` | Yes — shared guard, cannot drift from the tiles copy |

## Auth Model

⚠ **Gating is per-HANDLER, not per-route.** Several `+server.ts` files export a
gated mutating handler beside an ungated read handler. A file-level search for
`requireAdminToken` marks those routes "gated" and is how the rows below were
wrong on the first pass. Audit per exported handler.

| Handler | Auth | Notes |
|---|---|---|
| `POST /api/command` | `requireAdminToken` via `publishRoute` | Fail-closed: **503 when `AERO_ADMIN_TOKEN` is unset** |
| `PATCH /api/config` | `requireAdminToken` via `publishRoute` | Same wrapper; verified by reading the import, not the comment |
| `POST /api/assets` / `POST /api/content` / `DELETE /api/content/[id]` / `POST /api/update` | `requireAdminToken` | |
| `POST /api/fleet/heartbeat` | `requireBearerToken('AERO_FLEET_TOKEN')` | Deliberately a *different*, lower-privilege secret than `AERO_ADMIN_TOKEN`, so `health-check.sh` and peer-telemetry scripts need not hold admin credentials |
| `POST /api/wifi/reset` | `requireBearerToken` | |
| `GET /api/events` (SSE) / `GET /api/internal/token` / `GET /api/internal/thermal` | `isLoopback` | 403 for any non-loopback caller |
| `POST /api/status` | `isLoopback` | Write is loopback-only so a LAN attacker cannot poison the admin dashboard's view of a Pi |
| `GET /api/status` | **None** | Returns the full `DeviceStatus` plus `online`/`staleMs`. The *write* is gated, the *read* is not — see Sensitive Data Exposure |
| `GET /api/fleet/heartbeat` | **None** | Token-free on purpose: the admin dashboard polls it cross-origin without a bearer. Serves `?summary`, `?stats`, `?deviceId=` and the full latest set, with `lastError` stripped |
| `GET /api/assets` / `GET /api/content` | **None** | List endpoints; the mutating verbs beside them are gated |
| `GET /api/devices` | **None** | Returns `{deviceId, host, port}` only — mDNS facts, no device PII |
| `GET /api/tiles/*` / `GET /api/buildings/[city]` / `GET /api/roads/[city]` / `GET /api/bundle/[hash]` / `GET /api/assets/[filename]` | **None** | Read-only static content, path-guarded via `safeResolveWithin` |
| `OPTIONS` (all routes) | **None** | CORS preflight; carries no data |
| Admin UI `/admin` | **None** | No server guard — the *route* is open; every mutating API it calls is gated |
| SvelteKit hooks | — | No `hooks.server.ts` exists; auth is per-route by design |

CORS is **not** `*`. `http/cors.ts` reflects the request Origin only when it
matches `^https?://([a-z0-9-]+\.local|localhost)(:port)?$`, and emits no CORS
headers at all otherwise (silence, not 403, so same-origin callers still work).

This posture is documented as acceptable for a physically-isolated Pi kiosk
LAN. Not suitable for shared or public networks.

## CSP Configuration

From `svelte.config.js`:

| Directive | Value | Risk |
|---|---|---|
| `script-src` | `self unsafe-eval` | Medium — `unsafe-eval` required by Cesium/protobufjs |
| `style-src` | `self unsafe-inline fonts.googleapis.com` | Low — Svelte scoped styles |
| `connect-src` | `self` + `ws: wss: http: https:` + CDN allowlist | **Medium** — scheme wildcards make the CDN allowlist decorative. `ws:`/`wss:` are required by Vite HMR, see below. |
| `img-src` | `self data: blob:` + enumerated CDN origins | Low |
| `worker-src` | `self blob:` | Low — Cesium web workers |
| `font-src` | `self fonts.gstatic.com` | Low |

The `connect-src` scheme wildcards exist for LAN fleet discovery: peers live on
arbitrary `.local` hosts and ports, which CSP has no syntax to express.

⚠ **Do not "clean up" `ws:`/`wss:`.** They look dead — application code has
constructed no `WebSocket` since the SSE migration — but this `csp` block is
**unconditional**, so SvelteKit applies it in `bun run dev` as well as in the
build, and **Vite HMR runs over a WebSocket**. Removing them breaks hot reload
with a CSP console error and no visible page change, which is precisely the
wedged-HMR failure mode that reads as "my edit didn't work" for an hour.
Make the block dev-conditional first if these are ever to be dropped.

## Sensitive Data Exposure

| Data | Where | Risk |
|---|---|---|
| Cesium Ion token | `VITE_CESIUM_ION_TOKEN` → client bundle | Readable in browser source. Mitigate with a domain-restricted token in the Ion dashboard. Tokenless operation degrades to the offline buildings/terrain tiers rather than failing. |
| Mapbox token (if set) | `VITE_MAPBOX_TOKEN` → client bundle | Same exposure class; use a URL-restricted public token. |
| `AERO_ADMIN_TOKEN` / `AERO_FLEET_TOKEN` | Server env only — no `VITE_` prefix, so Vite never inlines them | Never reach the bundle. Peer fan-out fetches the admin token from loopback-only `/api/internal/token`. |
| mDNS peer list | `/api/devices`, unauthenticated | Low — hostnames and ports of Pis on the same LAN, no UA/GPU/screen. |
| Device status | `GET /api/status`, unauthenticated | Low-Medium — full `DeviceStatus` for the serving Pi: fps, commit, mode, telemetry summary. Same class as the heartbeat row below; note the POST that *writes* it is loopback-gated. |
| Fleet operational telemetry | `GET /api/fleet/heartbeat`, unauthenticated | Low–Medium — `deviceId`, `role`, `groupId`, `fps`, `temp`, `uptime`, `crashCount`, `commit`, `mode`, `throttle` to any LAN client. Not PII (the old WS registry's hostname/UA/GPU/screen is gone), but it does disclose the running **build SHA** and per-device health. `lastError` — a raw journal line — is explicitly deleted by `stripInternal()` before serving. |

## Findings Ledger

Re-verified 2026-08-20 against current source. IDs preserved from the original
security review for traceability.

| ID | Original severity | Status | Evidence |
|---|---|---|---|
| C2 | Critical | **Obsolete** | `?server=` → `new WebSocket()` SSRF. No `WebSocket` constructor exists anywhere in `src/`; the fleet transport is SSE. Verified tree-wide that nothing reads the parameter (`rg "get\(['\"]server" src/` → no matches). |
| C3 | Critical | **Accepted, documented** | `?device=` still overwrites the stored id with no allowlist — this is the intended operator field-assignment path (`fleet/device-id.ts`), now a single resolver with a `console.warn` on reassignment. Residual: no length bound on the id. |
| H2 | High | **Fixed** | Tile path traversal. `safeResolveWithin()` appends the trailing slash before `startsWith`, and compares `realpath` on both sides to block symlinks planted inside the root. |
| H3 | High | **Mitigated → Low** | Admin→display relay. Now bearer-gated and fail-closed (503 without a token), 4 KB body cap. Residual: payload shape past `type: string` is unvalidated; unknown types are no-ops in the browser handler. |
| H4 | High | **Open, downgraded → Medium** | `connect-src` scheme wildcards remain. The SSRF they enabled (C2) is gone, so this is defence-in-depth only. `http:`/`https:` are needed for LAN peer discovery; `ws:`/`wss:` are needed by Vite HMR because the CSP block is not dev-conditional. Tightening requires splitting dev and prod CSP first. |
| M6 | Medium | **Fixed** | `/api/tiles/health` returns `{status, hasTiles, layers}` — layer directory *names*, never the absolute `TILE_DIR`. |

**How to re-verify:** every row above was checked by reading the named file,
and every auth row by reading each individual exported handler rather than
searching the file as a whole.
When this file is next touched, re-check rather than copy — and if a check is
skipped, mark the row `UNVERIFIED` instead of carrying the old verdict forward.
