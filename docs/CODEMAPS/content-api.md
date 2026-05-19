# Content Push API Codemap

**Last updated:** 2026-04-15

The device runs its own HTTP server on the same port as the SvelteKit app. Anyone on the LAN can push content bundles + media assets to it, with no auth (LAN-only design — auth comes before commercial release).

## Endpoints

```
GET    /api/content                  → { bundles: ContentBundle[] }
POST   /api/content                  → { ok, id }            body: ContentBundle JSON
DELETE /api/content/[id]             → { ok }                404 if not present

GET    /api/assets                   → { assets: AssetInfo[] }
POST   /api/assets                   → { ok, asset }         multipart, field 'file'
GET    /api/assets/[filename]        → file bytes            with mime + immutable cache
```

## Storage

```
data/bundles/<id>.json               # one JSON file per bundle
data/assets/<sha256-prefix>.<ext>    # content-addressed (auto-dedupe)
```

Override paths via env (set on Pi):
```
AERO_BUNDLES_DIR=/var/aero/bundles
AERO_ASSETS_DIR=/var/aero/assets
```

## Validation

| Layer | Check |
|---|---|
| Bundle shape | `isContentBundle()` — id/type/kind/z presence + types |
| Bundle id | `^[a-zA-Z0-9_-]{1,64}$` (filesystem-safe) |
| Bundle size | 64 KB max body |
| Asset extension | mp4, webm, png, jpg, jpeg, webp |
| Asset size | 50 MB max upload |
| Asset filename (serve) | `^[a-f0-9]{16}\.(mp4|webm|png|jpg|jpeg|webp)$` (path-traversal block) |

## Failure semantics

The kiosk **never blocks on content push**.
- Endpoint unreachable on boot → `hydrateFromServer()` silently no-ops; stock effects render.
- Malformed JSON on disk → `disk.server.ts` skips with warning.
- Missing asset URL inside a bundle → effect mounts, `<video>` shows nothing.
- POST 4xx → web UI shows toast, no state change.

## Boot hydration flow

```
+page.svelte onMount
  → client.hydrateFromServer()
  → fetch GET /api/content
  → for each bundle: bundleStore.install(bundle)
  → bundleStore.effects derives reactively
  → compositor sees new effects
  → mounts them when their `when` predicate is true
```

## Push flow (CLI)

```bash
# install a bundle
curl -X POST http://aero-display-00.local:5173/api/content \
  -H "Content-Type: application/json" \
  -d @aurora-himalayas.json

# upload a video asset, get a URL to put inside a bundle
curl -X POST http://aero-display-00.local:5173/api/assets \
  -F file=@aurora.mp4
# → { ok: true, asset: { filename: "8a3f4d…webm", size: 9384812, url: "/api/assets/8a3f4d…webm" } }

# list / delete
curl http://aero-display-00.local:5173/api/content | jq
curl -X DELETE http://aero-display-00.local:5173/api/content/aurora-himalayas
```

## Push flow (web UI)

`/content` → drag a `.json` (becomes a bundle) or `.mp4`/`.png` (becomes an asset). Upload returns the asset URL, copied to clipboard automatically. Drop the URL into the JSON bundle's `asset:` or `image:` field.

## Why content-addressed assets

- Same .mp4 uploaded to 18 Pis → 18 identical hashes → all bundles reference the same path → easy to swap a video without re-pointing every bundle
- File renames don't break references — the URL contains the hash, not the original name
- `Cache-Control: immutable` is safe because the URL is a hash

## Bundle types

See [scene.md](./scene.md) for the full Effect contract. Currently supported:

- `video-bg` — full-scene HTML5 video loop
- `sprite` — Cesium Billboard at lat/lon

Adding a new BundleType requires updating `scene/bundle/types.ts` (union) and `scene/bundle/loader.ts` (dispatcher). TypeScript exhaustiveness checks enforce the second step.
