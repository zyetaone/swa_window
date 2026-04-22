# Aero Dynamic Window — Project Document

> Historical analysis snapshot. Useful for context, but parts of the file map and deployment notes have drifted from the current implementation.

> A circadian-aware digital airplane window display for office wellbeing.
> Built for Southwest Airlines Hyderabad by Zyeta / Studio ArcX.

---

## 1. What Is It

A Raspberry Pi-powered kiosk that renders a realistic airplane window view on a wall-mounted display. The "window" shows a continuous flight over real-world terrain — cities, mountains, oceans — synced to the viewer's local time of day. Dawn breaks in the morning, city lights glow at night. Clouds drift, turbulence rumbles, shooting stars appear.

It's an ambient display, not a game. Think: a living painting of the view from seat 14A at 35,000 feet.

## 2. How It Works

### The Mental Model: Camera + Portal + World

The simulation has three conceptual layers:

```
┌──────────────────── THE PORTAL (CSS window frame) ────────────────────┐
│                                                                        │
│   Glass vignette · Frost · Wing silhouette · Rain · Lightning         │
│                                                                        │
│   ┌────────────── THE ATMOSPHERE (SVG/CSS clouds) ─────────────┐      │
│   │   Near clouds ← fast parallax (0.9x heading)               │      │
│   │   Mid clouds  ← moderate parallax (0.4x heading)           │      │
│   │   Far clouds  ← slow parallax (0.15x heading)              │      │
│   │   Tilted 38° perspective → receding cloud deck illusion     │      │
│   └─────────────────────────────────────────────────────────────┘      │
│                                                                        │
│   ┌────────────── THE WORLD (Cesium globe) ────────────────────┐      │
│   │   Real Earth terrain + satellite imagery                    │      │
│   │   3D OSM Buildings with night-aware styling                 │      │
│   │   NASA VIIRS night lights + CartoDB road glow               │      │
│   │   Color grading post-process (circadian warmth)             │      │
│   └─────────────────────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────────────────────┘
```

**The camera moves, not the world.** The Cesium globe is the actual Earth — stationary. A virtual camera at `(lat, lon, altitude, heading, pitch)` orbits over each city in elliptical flight paths or follows hand-authored waypoint scenarios. Every animation frame (~30fps), the camera position updates and the Cesium viewer renders the terrain from that vantage point.

**The sky is a horizontal slice.** Clouds are NOT a sky dome. `CloudBlobs.svelte` renders 12 cloud shapes in a flat band tilted with `perspective(700px) rotateX(38deg)`, creating the illusion of looking down at a cloud deck from cruise altitude. Three depth layers (far/mid/near) shift at different rates when heading changes, producing parallax depth without any 3D engine.

**The window is a CSS overlay stack.** Dark borders, radial vignettes, frost gradients, a wing silhouette — all pure CSS positioned above the Cesium canvas.

### The Tick Loop

`Window.svelte` runs a single `requestAnimationFrame` loop. Each frame:

1. `model.tick(delta)` updates all simulation state
2. Cesium re-renders the globe from the new camera position
3. CSS `$derived` values propagate to cloud positions, sky gradients, weather effects

Inside `tick()`, nine sub-ticks run in sequence:

| Sub-tick | What it does |
|----------|-------------|
| `tickFlightPath` | Moves camera along orbit ellipse or waypoint scenario |
| `tickDeparture` | Ramps warp speed, closes blind (cruise transition) |
| `tickTransit` | Teleports to new location, opens blind |
| `tickDirector` | Auto-pilot: picks next city every 2-5 minutes |
| `tickLightning` | Random flashes during storm weather |
| `tickMotion` | Turbulence, banking, engine vibration, breathing sway |
| `tickAltitude` | Gradual altitude adjustments for day/night |
| `tickMicroEvents` | Shooting stars, birds, contrails (surprise moments) |
| `tickRandomize` | Slow-drifts cloud density, haze, speed, weather |

### Flight State Machine

```
          flyTo(locationId)
orbit ──────────────────────→ cruise_departure ──(2s warp)──→ cruise_transit ──(2s)──→ orbit
 ↑                             blind closes                    teleport +               ↑
 │                             speed ramps up                  blind opens              │
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

The Director auto-pilot triggers `flyTo()` every 2-5 minutes, weighted by time of day: nature scenes in the morning, cities at midday and night.

### Rendering Layers (z-order)

```
z:0   Cesium globe (terrain, buildings, night lights, road glow, post-process)
z:1   CloudBlobs (SVG feTurbulence + feDisplacementMap, CSS drift animation)
z:2   Weather (CSS rain drops + lightning flash overlays)
z:3   Micro-events (shooting star streak, bird wings, contrail line)
z:5   Frost (opacity scales with altitude 25k-40k ft)
z:7   Wing silhouette (CSS positioned in bottom-left corner)
z:9   Glass vignette (radial gradient, darkens edges)
z:10  Window frame vignette (outer darkening)
z:11  Glass recess rim (inner shadow for depth)
```

## 3. The Technology

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | SvelteKit 2 + Svelte 5 runes | Reactive state ($state/$derived), compiles to minimal JS, server-side rendering disabled |
| Terrain | Cesium.js | Only real 3D globe engine with satellite imagery + terrain + buildings |
| Clouds | SVG feTurbulence + CSS animation | GPU-light, runs on Pi 5 VideoCore VII, no WebGL shader needed |
| Styling | Tailwind CSS v4 + scoped styles | Component CSS for layers, Tailwind for admin panel |
| Build | Vite 7 + adapter-node | Single bundle for Pi deployment, Bun runtime |
| State | Svelte 5 class with $state fields | AeroWindow is a single reactive class, context-provided |
| Fleet | Bun WebSocket server | Master Pi broadcasts state to display Pis over LAN |
| Hardware | Raspberry Pi 5 (16GB) | ARM Cortex-A76 4-core, VideoCore VII GPU, 512MB CMA |

### Cloud Rendering: SVG feTurbulence

Clouds use the CSS-Tricks SVG filter technique instead of WebGL shaders:

1. Each cloud is a `<div>` with a white/colored background
2. An SVG `<filter>` applies `feTurbulence` (fractal noise) → `feDisplacementMap` (warps the shape) → `feGaussianBlur` (softens edges)
3. CSS `@keyframes drift` translates clouds horizontally (-60% → 130%)
4. 12 clouds across 3 depth layers, each with unique seed, octaves, frequency, displacement
5. The `seed` parameter morphs over time: `seed + Math.floor((time + offset) / 90)` creates slow shape evolution
6. Heading shifts clouds laterally (near clouds fast, far clouds slow → parallax)
7. Altitude shifts the deck vertically (higher = clouds appear lower)

This runs at ~30fps on Pi 5 with zero WebGL overhead beyond Cesium itself.

### Cesium Sub-systems

`CesiumManager.ts` decomposes into 6 inner classes:

| Class | Responsibility |
|-------|---------------|
| `CesiumCamera` | Smooth-lerps camera to model position each frame |
| `CesiumTerrain` | Ion or self-hosted terrain with vertex normals + water mask |
| `CesiumImagery` | ESRI satellite base + NASA VIIRS night lights + CartoDB road glow |
| `CesiumAtmosphere` | Globe base color, sky atmosphere, fog (per-location density) |
| `CesiumBuildings` | OSM Buildings 3D Tiles with night-aware building-class styling |
| `CesiumPostProcess` | GLSL color grading shader (circadian warmth tinting) |

## 4. What Was Built (Session 2026-04-13)

### From Zero to Standalone Kiosk in One Session

Started with: a broken viewport (black screen), scattered code across multiple repos, no deployment strategy.

Ended with: a Pi 5 running standalone with auto-start services, fleet management, and a 7-phase plan for multi-screen installation.

#### Commits (16 on origin/main)

1. **SVG cloud rewrite** — Replaced 383 lines of GLSL shader with 167 lines of SVG feTurbulence. Three iterations: basic → horizon band → full parallax depth with heading/altitude/windAngle coupling.

2. **Infrastructure port** — 6-agent parallel team ported from `feat/offline-tiles` branch: shared types, admin panel, fleet server, WebSocket client, tile infrastructure, static assets.

3. **Pi 5 deployment** — Three systemd services (app, fleet, kiosk), WiFi power management, screen blanking disabled, CMA 512MB, GPU turbo ready (waiting for fan).

4. **Kiosk hardening** — Drag-only blind (no tap spam), `bundleStrategy:'single'` for embedded device, CSP fix for cross-port fleet communication.

5. **Research + docs** — Deep codebase analysis, UX enhancement proposals, Cesium OSM Buildings styling reference, Gaussian splat feature proposal, Entity vs Primitive API analysis.

#### Bug Fixes

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Black viewport | Altitude mask anyZone fallback rendered clouds at full density | Removed 3-line anyZone clause |
| CSS clouds not animating | Inline style conflicted with Svelte style handling | Moved animation properties to CSS class |
| 3D perspective broke drift | rotateX on children broke translateX | Moved perspective to container only |
| Pi X server blocked | SSH-launched xinit denied | `allowed_users=anybody` in Xwrapper.config |
| Pi WebGL failed | Wrong Chromium GL flags | `--use-gl=angle --use-angle=gles` combo |
| Admin "no devices" | CSP blocked cross-port fetch | Added `http: https:` to connect-src |
| Fleet port conflict | PORT env leaked from app server | Explicit `PORT=3001` in service file |

### Pi 5 Current State

```
Hostname:   aero-display-00.local
IP:         192.168.31.129 (LAN)
SSH:        pi@aero-display-00.local (key auth)
Remote:     Pi Connect enabled (connect.raspberrypi.com)
Services:   aero-xserver, aero-app (:5173), aero-kiosk (Chromium)
Auto-start: Yes — survives power cycle
WiFi:       Current network + rick-hotspot (arcx12345)
GPU:        VideoCore VII, CMA 512MB, turbo commented (needs fan)
Temp:       ~76°C (no active cooling yet)
Screen:     2560x1080 monitor (Waveshare 21.5" touch pending)
Chromium:   --kiosk --use-gl=angle --use-angle=gles --enable-webgl
```

## 5. Codebase Architecture

### File Map

```
src/lib/
├── core/                          # State + logic
│   ├── AeroWindow.svelte.ts  801 # THE model: 35+ $state, 9 tick methods, Director
│   ├── flight-scenarios.ts    484 # Waypoint data for 10+ cities
│   ├── ws-client.svelte.ts    211 # Fleet WebSocket client ($state.raw for WS)
│   ├── persistence.ts          77 # localStorage save/load
│   └── index.ts                58 # Context provider + re-exports
├── layers/                        # Visual rendering
│   ├── Window.svelte          945 # Layer compositor + RAF loop + CSS
│   ├── SidePanel.svelte       707 # Settings UI (location, weather, time, sliders)
│   ├── cesium/CesiumManager.ts 595 # 6 inner classes: Camera/Terrain/Imagery/etc.
│   ├── Controls.svelte        269 # HUD overlay
│   ├── CesiumViewer.svelte    239 # Thin wrapper mounting CesiumManager
│   ├── CloudBlobs.svelte      167 # SVG feTurbulence clouds (3-depth parallax)
│   ├── cesium-shaders.ts       98 # GLSL color grading
│   ├── AirlineLoader.svelte    76 # Loading screen
│   └── controls/              190 # RangeSlider + Toggle components
├── shared/                        # Canonical types + constants
│   ├── constants.ts           200 # AIRCRAFT, FLIGHT_FEEL, CESIUM, WEATHER_EFFECTS
│   ├── locations.ts           100 # 10+ cities with lat/lon/altitude/hasBuildings
│   ├── protocol.ts            100 # Fleet message types
│   ├── types.ts                25 # SkyState, LocationId, WeatherType, Location
│   ├── utils.ts                30 # clamp, lerp, normalizeHeading, formatTime
│   └── index.ts                20 # Barrel exports
├── admin-store.svelte.ts      254 # Fleet admin transport (WS + SSE)
│
routes/
├── +page.svelte                   # Main app (createAeroWindow, RAF, auto-save)
├── admin/+page.svelte         500 # Fleet control panel
├── playground/+page.svelte    140 # Cloud sandbox with live sliders
└── architecture/+page.svelte  700 # In-app documentation / architecture page

server/src/                        # Fleet server (Bun)
├── index.ts                       # HTTP + WebSocket
└── ws.ts                          # WS message handling

scripts/                           # Offline tile caching helpers
tile-server/                       # Self-hosted tile server
deploy/                            # Pi provisioning scripts
```

**Total: ~5,900 lines** across 25 source files. For a product with Cesium terrain + 3D buildings + clouds + weather + day/night cycle + flight sim + fleet management + admin panel + offline mode — this is lean.

### State Flow

```
System clock ──→ +page.svelte ($effect) ──→ model.updateTimeFromSystem()
                                              │
User input ──→ SidePanel.svelte ──→ model.applyPatch({...})
                                              │
Fleet server ──→ ws-client ──→ model.applyPatch({...})
                                              │
                                    ┌─────────▼─────────┐
                                    │   AeroWindow      │
                                    │   tick(delta)      │◄── Window.svelte RAF loop
                                    │                    │
                                    │   $state fields    │──→ $derived values
                                    └─────────┬─────────┘
                                              │
                              ┌───────────────┼───────────────┐
                              ▼               ▼               ▼
                        CesiumManager    CloudBlobs      Window.svelte
                        (globe render)   (SVG clouds)    (CSS effects)
```

## 6. The Vision: Multi-Screen Installation

### Physical Setup (SWA Hyderabad)

4 Raspberry Pis behind a wall, each driving one screen:

```
[Pi 16GB Master] ─── ethernet ─── [5-port GbE switch]
[Pi 8GB #1]      ─── ethernet ───        │
[Pi 8GB #2]      ─── ethernet ───        │
[Pi 8GB #3]      ─── ethernet ───        │
```

Master runs app + fleet server. Display Pis run Chromium kiosk pointing at master.

### Cylindrical World Concept

The sky and clouds form a continuous panorama. Each screen shows a different angular slice:

```
Screen 0: heading + 0°     Screen 1: heading + 20°     Screen 2: heading + 40°
┌──────────────┐           ┌──────────────┐           ┌──────────────┐
│  clouds ←    │           │   clouds →   │           │    clouds →→ │
│  terrain A   │           │  terrain B   │           │   terrain C  │
└──────────────┘           └──────────────┘           └──────────────┘
```

Walking past the screens = looking at the sky from different angles. Near clouds shift fast between screens, far clouds barely change — the same parallax logic that already works within a single screen, extended across screens via URL params.

Implementation: `?screen=1&totalScreens=3&server=ws://master:3001/ws`

### Hardware Budget

| Item | Qty | Unit | Total |
|------|-----|------|-------|
| Pi 5 16GB (master, already have) | 1 | $0 | $0 |
| Pi 5 8GB (display) | 3 | $80 | $240 |
| Waveshare 21.5" Touch | 4 | $250 | $1,000 |
| Network + cables + cooling | - | - | $120 |
| Mounting + SD cards | - | - | $100 |
| **Total** | | | **~$1,460** |

Monthly: $0-25 (self-hosted tiles or Cesium Ion free tier).

## 7. Implementation Plan (Confirmed)

| Phase | Task | Effort |
|-------|------|--------|
| 1 | Fan + GPU turbo (hardware) | 0.5h |
| 2 | 3D Tiles buildings height-filtered | 1.5h |
| 3 | Self-hosted tiles for 10 SWA cities | 2h |
| 4 | AeroWindow refactor → 5 composed classes | 2.5h |
| 5 | Multi-screen parallax URL params | 1.5h |
| 6 | Everything else (captive portal, sound, voice, CORENET demo) | 10h |
| **Total** | | **18h** |

### Security Pre-Install Checklist

1. Validate `?server=` WebSocket URL (whitelist localhost + LAN)
2. Lock device ID to provisioning file (not URL param)
3. Add shared-secret auth to fleet server
4. Firewall port 3001 when captive portal active
5. Sanitize DEVICE_NAME in provision-pi.sh

## 8. Known Issues + Uncommitted State

### Minimax (opencode) Changes in Working Tree

An AI editor (Minimax via opencode) made uncommitted changes:

| Change | Assessment |
|--------|-----------|
| DELETE core/constants.ts, locations.ts, types.ts, utils.ts | **SAFE** — these were re-export shims; shared/ is canonical |
| DELETE CloudCanvas.svelte | **SAFE** — replaced by CloudBlobs.svelte |
| DELETE cloud-post-process.reference.ts | **SAFE** — reference code, belongs in docs/ if needed |
| DELETE cloud-shader.ts | **SAFE** — old GLSL shader, replaced by SVG approach |
| MODIFY AeroWindow.svelte.ts | **NEEDS REVIEW** — Minimax changed ~184 lines |
| MODIFY CesiumViewer.svelte (648→239) | **NEEDS REVIEW** — massive reduction |
| MODIFY core/index.ts | **SAFE** — updated re-exports to match deletions |
| NEW shared/constants.ts (+34 lines) | **NEEDS REVIEW** — constants may have moved here |

### Build Error

`fetchBuildings` function referenced but deleted by Minimax. Needs `bun run check` to verify.

### Pending UX Enhancements

- Direction toggle (orbit direction reversal)
- Blind direction follows flight heading
- Long-press speed ramp (2s=3x, 4s=5x, 6s=10x)
- Condensation droplets during rain
- Window frame metallic highlight shift with "sunlight"

---

*Last updated: 2026-04-13*
