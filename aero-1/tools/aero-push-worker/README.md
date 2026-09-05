# Aero Push Worker

Cloudflare Worker that ships content **bundles** and per-device **config patches** to z-aero-window devices over the public internet — the "firmware update" channel for fleets that aren't on a VPN.

This is **additional** to the LAN fleet server in `src/lib/fleet/`. Devices keep working without it; if `VITE_PUSH_WORKER_URL` is set, they also poll this Worker every 60s and apply whatever they find.

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET    | `/health`              | -     | `{ ok: true, version }` for liveness |
| GET    | `/bundles/:deviceId`   | -     | All bundles targeting this device |
| POST   | `/bundles`             | bearer | Upload/replace a bundle JSON |
| DELETE | `/bundles/:id`         | bearer | Remove a bundle |
| GET    | `/configs/:deviceId`   | -     | Per-device config patches |
| POST   | `/configs/:deviceId`   | bearer | Replace per-device config patch list |

Read endpoints are **device-scoped but not secret** — they only return what's targeted at the requesting `deviceId`. Write endpoints require `Authorization: Bearer $ADMIN_TOKEN`.

## Bundle targeting

Each bundle JSON may include a `targets` field:

```jsonc
{
  "id": "aurora-himalayas-2026",
  "type": "video-bg",
  "targets": ["aero-display-04", "aero-display-07"]   // or ["*"] for all
  // ...rest of bundle fields, opaque to the Worker
}
```

If `targets` is missing or empty, the bundle is broadcast to all devices.

## Setup

### 1. Install

```bash
cd tools/aero-push-worker
bun install
```

### 2. Create KV namespaces

```bash
bunx wrangler kv namespace create BUNDLES
bunx wrangler kv namespace create BUNDLES --preview
bunx wrangler kv namespace create CONFIGS
bunx wrangler kv namespace create CONFIGS --preview
```

Copy the four returned IDs into `wrangler.jsonc` (replacing the `REPLACE_WITH_*` placeholders).

### 3. Set the admin token

```bash
bunx wrangler secret put ADMIN_TOKEN
# paste a strong random string when prompted
```

### 4. Deploy

```bash
bun run deploy
```

Wrangler prints the deployed URL, e.g. `https://aero-push-worker.your-subdomain.workers.dev`.

### 5. Point devices at it

On each Pi (or in the fleet config), set:

```bash
VITE_PUSH_WORKER_URL=https://aero-push-worker.your-subdomain.workers.dev
```

Devices read this at build time and start polling automatically.

## Admin examples

```bash
# Push a bundle to all devices
curl -X POST https://aero-push-worker.your-subdomain.workers.dev/bundles \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "winter-2026",
    "type": "video-bg",
    "targets": ["*"],
    "asset": "https://cdn.example.com/aurora.webm",
    "opacity": 0.7
  }'

# Push a config patch to one device (force night mode + disable buildings)
curl -X POST https://aero-push-worker.your-subdomain.workers.dev/configs/aero-display-04 \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[
    { "path": "timeOfDay",     "value": 22 },
    { "path": "showBuildings", "value": false }
  ]'

# What's currently targeted at this device?
curl https://aero-push-worker.your-subdomain.workers.dev/bundles/aero-display-04
curl https://aero-push-worker.your-subdomain.workers.dev/configs/aero-display-04

# Remove a bundle
curl -X DELETE https://aero-push-worker.your-subdomain.workers.dev/bundles/winter-2026 \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Sanity check
curl https://aero-push-worker.your-subdomain.workers.dev/health
```

## Local dev

```bash
bun run dev
# Serves on http://localhost:8787 with the preview KV namespaces.
```

You can pass `--var ADMIN_TOKEN:dev-token` to wrangler dev or set it in `.dev.vars`.

## Security notes

- The bearer token is the only barrier on writes — keep it strong and rotate it.
- Reads are public-by-deviceId. Choose unguessable device IDs if you treat targeting as security (e.g. `aero-display-${uuid}`). For most fleets, public reads are fine because nothing sensitive is in the payloads.
- Worker is stateless besides KV. KV is eventually consistent — expect ~60s for changes to propagate to all edge regions.

## Cost

Free-tier safe at typical fleet sizes:
- Workers: 100k requests/day free.
- KV: 100k reads/day, 1k writes/day, 1 GB storage free.
- For a 100-device fleet polling every 60s: ~288k reads/day → split between bundles + configs ≈ within free tier with a small overage; bump poll interval to 5min for headroom.
