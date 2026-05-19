# Security Boundary Map

**Last Updated:** 2026-04-14

## Trust Boundaries

### Data Entry Points

| Entry Point | Source | Handler | Validated? |
|---|---|---|---|
| `?location=` URL param | Browser | +page.svelte:64-68 | Yes — `LOCATION_MAP.has()` |
| `?altitude=` URL param | Browser | +page.svelte:71-80 | Yes — `isFinite` + AIRCRAFT bounds |
| `?server=` URL param | Browser/attacker | fleet-client.svelte.ts:154 | **No** — raw WebSocket URL (SSRF) |
| `?device=` URL param | Browser/attacker | fleet-client.svelte.ts:10-13 | **No** — stored in localStorage |
| `?display=` URL param | Browser/attacker | fleet-client.svelte.ts:96 | **No** — unbounded string |
| WS `set_scene` | Fleet hub | fleet-client.svelte.ts:#handleMessage | Yes — location via LOCATION_IDS, weather via allowlist |
| WS `set_mode` | Fleet hub | fleet-client.svelte.ts:#handleMessage | Partial — mode validated, `payload` (videoUrl) unvalidated |
| WS `set_config` | Fleet hub | fleet-client.svelte.ts:#handleMessage | Yes — delegates to applyPatch with clamps |
| WS `set_quality` | Fleet hub | fleet-client.svelte.ts:#handleMessage | Yes — mode via allowlist |
| localStorage | Browser storage | persistence.ts:loadPersistedState | Yes — type checks, enum allowlists, numeric bounds |
| Admin WS forward | Admin browser | fleet-hub.ts:129-133 | **No** — `cmd.message` forwarded as-is |
| REST POST /api/fleet | Any HTTP client | fleet/+server.ts:33-55 | **No** — body fields used directly |

## Auth Model

| Endpoint | Auth | Status |
|---|---|---|
| Fleet REST API | None | Open on LAN, CORS `*` |
| Fleet WS (display) | `?role=display` param | Client-asserted, no credential |
| Fleet WS (admin) | `?role=admin` param | Client-asserted, no credential |
| Admin UI `/admin` | None | No server guard |
| SSE `/api/events` | None | Full device registry exposed |
| SvelteKit hooks | None | No `hooks.server.ts` exists |

This is documented as acceptable for a physically-isolated Pi kiosk deployment. Not suitable for shared/public networks.

## Validation Points

| Location | What | Quality |
|---|---|---|
| `persistence.ts` | All localStorage fields | Thorough — type, enum, bounds |
| `fleet-client.svelte.ts` | Incoming WS messages | Adequate — enum checks, but videoUrl unvalidated |
| `app-state.svelte.ts:applyPatch()` | All patchable fields | Adequate — clamp numerics, typeof booleans, weather enum |
| `+page.svelte` | URL params | Correct for location/altitude |
| `fleet-hub.ts` (admin path) | Admin → display relay | **Gap** — no validation on forwarded message |
| `fleet/+server.ts` | REST body | **Gap** — no validation |
| `tiles/+server.ts` | Path traversal | Present but incomplete (missing trailing slash in startsWith) |

## CSP Configuration

From `svelte.config.js`:

| Directive | Value | Risk Level |
|---|---|---|
| `script-src` | `self unsafe-eval` | Medium — eval required by Cesium/protobufjs |
| `style-src` | `self unsafe-inline fonts.googleapis.com` | Low — required for Svelte scoped styles |
| `connect-src` | `self ws: wss: http: https: <CDN list>` | **High** — scheme wildcards disable CSP as SSRF guard |
| `img-src` | `self data: blob: <CDN allowlist>` | Low — enumerated CDN origins |
| `worker-src` | `self blob:` | Low — Cesium web workers |
| `font-src` | `self fonts.gstatic.com` | Low |

The `connect-src` wildcard is intentional for LAN fleet server discovery but eliminates CSP protection against `?server=` SSRF.

## Sensitive Data Exposure

| Data | Where | Risk |
|---|---|---|
| Cesium Ion token | `VITE_CESIUM_ION_TOKEN` → client bundle | Readable in browser source. Mitigate with domain-restricted token in Ion dashboard. |
| `TILE_DIR` filesystem path | `tiles/+server.ts:34` health response | Leaks server layout to any HTTP client |
| Device registry | fleet-hub `getDevices()` → `/api/fleet` | Full PII (hostname, UA, GPU, screen) to unauthenticated caller |
| GPU renderer string | `fleet-client.svelte.ts:getDeviceCaps()` | Sent in register, stored in registry, broadcast to admins |

## Open Findings (from security review)

| ID | Severity | Summary |
|---|---|---|
| C2 | Critical | `?server=` SSRF — raw URL to WebSocket constructor |
| C3 | Critical | `?device=` identity takeover — persisted to localStorage |
| H2 | High | Tile path traversal — missing trailing slash in startsWith |
| H3 | High | Admin WS forwards unvalidated ServerMessage to displays |
| H4 | High | CSP connect-src wildcard neutralizes SSRF protection |
| M6 | Medium | Health endpoint leaks TILE_DIR absolute path |
