# Aero Window v2: Architecture Council Analysis

> Five-perspective analysis of evolving from single-display app to multi-display experience platform.
> Date: 2026-02-12 | Status: Research/Proposal

---

## Table of Contents

1. [Council Question](#council-question)
2. [Current System (Grounded in Code)](#current-system-grounded-in-code)
3. [Five Perspectives](#five-perspectives)
   - [Architect: System Design](#1-architect-system-design)
   - [Product Designer: UX + Content Model](#2-product-designer-ux--content-model)
   - [Pragmatic Developer: Feasibility](#3-pragmatic-developer-feasibility)
   - [DevOps/Fleet: Deployment + Reliability](#4-devopsfleet-deployment--reliability)
   - [Creative Director: 10x Thinking](#5-creative-director-10x-thinking)
4. [Council Deliberation](#council-deliberation)
5. [Recommended Architecture](#recommended-architecture)
6. [Implementation Phases](#implementation-phases)
7. [What to AVOID](#what-to-avoid)
8. [Revisit Conditions](#revisit-conditions)

---

## Council Question

How should a single-display SvelteKit + CesiumJS airplane window app evolve into a 6-display, API-driven, extensible digital experience platform -- without overengineering, and with value at every step?

### Constraints
- Team of 1 developer
- Pi 5 is the display target (limited GPU, 8GB RAM)
- Current SvelteKit/Cesium codebase exists and works
- Must be incrementally buildable (ship value at each step)
- Must NOT be overengineered

---

## Current System (Grounded in Code)

The codebase is lean: ~12 files, ~2,000 lines of application code. Architecture is clean.

### File Inventory

| File | Lines | Role |
|------|-------|------|
| `WindowModel.svelte.ts` | 489 | Single source of truth. Position, time, weather, flight state. Owns `tick(delta)` game loop and `flyTo()` async state machine. |
| `ViewState.svelte.ts` | 108 | Pure derived presentation. No mutable state. Computes sky, frost, haze, glass effects. |
| `Window.svelte` | 557 | Layer compositor. Owns RAF tick loop. Composes Cesium + 4 CSS overlay layers. |
| `CesiumViewer.svelte` | 399 | Terrain, imagery, NASA night layer, OSM buildings with custom night shaders. HMR-safe. |
| `CloudLayer.svelte` | 128 | CSS parallax clouds. 10 procedural shapes, atmospheric perspective. |
| `CityLightsLayer.svelte` | 155 | CSS glow dots. Clustered distribution, twinkle animation. |
| `WeatherLayer.svelte` | 99 | CSS rain streaks + lightning flash. |
| `Controls.svelte` | 547 | Kiosk control panel. Auto-hides. Location grid, time presets, atmosphere tuning. |
| `constants.ts` | 82 | Aircraft physics, atmospheric constants. |
| `types.ts` | 5 | SkyState type. |
| `index.ts` | 58 | Context provider (createAppState, useAppState). |
| `+page.svelte` | 207 | Root. Creates context, renders cabin wall + window + controls. |

### Key Architectural Properties

1. **Model/View separation is clean.** WindowModel owns simulation truth. ViewState derives all CSS-facing values. No bidirectional sync.

2. **All effects are CSS-only.** Three.js/Threlte was deleted. Clouds, city lights, weather, and glass are all CSS transforms + gradients + animations. GPU-composited on the display's hardware.

3. **Cesium is the only heavy renderer.** Single WebGL context for terrain + imagery + buildings.

4. **State flows one direction:** `model -> $derived -> DOM`.

5. **WindowModel is already serializable.** Every field is a primitive (number, string, boolean). No DOM refs, no framework objects. The entire state can be JSON.stringify'd today.

6. **Auto-cycle:** 10 preset locations, cycling every 25 minutes via `setInterval` in Window.svelte.

### State Shape (What Gets Synced)

```typescript
// Everything in WindowModel that would need to cross the wire:
{
  // Position
  lat: number, lon: number, altitude: number,
  heading: number, pitch: number, utcOffset: number,
  
  // Time
  timeOfDay: number, syncToRealTime: boolean,
  
  // Location
  location: LocationId,  // 'dubai' | 'himalayas' | ... (10 options)
  
  // Environment
  weather: WeatherType,  // 'clear' | 'cloudy' | 'overcast' | 'storm'
  cloudDensity: number, cloudSpeed: number, cloudScale: number,
  haze: number,
  
  // View
  blindOpen: boolean, showBuildings: boolean, showClouds: boolean,
  
  // Night
  nightLightIntensity: number, terrainDarkness: number,
  
  // Flight
  flightSpeed: number, isTransitioning: boolean,
  transitionDestination: string | null,
}
```

This is roughly 200 bytes of JSON. Sending this at 1Hz over WebSocket is trivial.

---

## Five Perspectives

### 1. Architect: System Design

#### Core Insight: The controller is a SvelteKit route, not a separate service.

The existing Model/View separation maps perfectly to a Controller/Display split. WindowModel already has setter methods for every field (`setLocation`, `setAltitude`, `setWeather`, etc.). Adding a `applyPatch(state: Partial<ModelState>)` method is ~20 lines.

#### Topology

```
                    +----------------------+
                    |   Controller (Pi 5)  |
                    |                      |
                    |  +----------------+  |
                    |  | SceneScheduler |  |  <-- Decides WHAT to show
                    |  |  - calendar    |  |  <-- Date/time rules
                    |  |  - API server  |  |  <-- REST + WebSocket
                    |  +-------+--------+  |
                    |          | JSON state |
                    +----------+------------+
                               |
              +----------------+----------------+
              |                |                 |
    +---------v--+   +--------v---+   +--------v---+
    | Display 1  |   | Display 2  |   | Display 6  |
    |            |   |            |   |            |
    | WindowModel|   | WindowModel|   | WindowModel|
    | (receives) |   | (receives) |   | (receives) |
    | ViewState  |   | ViewState  |   | ViewState  |
    | Renderer   |   | Renderer   |   | Renderer   |
    +------------+   +------------+   +------------+
```

#### Where State Lives

- **Controller** holds authoritative scene state (which scene, which location, which weather)
- **Displays** hold local rendering state (Cesium camera, CSS animation frames, tick clock)
- **Controller pushes scene-level commands**, not frame-level updates. "Show Dubai at night with storms" not "set lat to 25.2048"
- **Displays run their own game loop.** The `tick(delta)` method continues to handle drift, heading wander, turbulence, lightning timing locally. The controller does not micromanage animation.

#### State Sync Protocol

```
Controller -> Display: SceneCommand (infrequent, ~1/minute or on change)
{
  type: 'scene',
  scene: 'default-flight',
  params: {
    location: 'dubai',
    weather: 'cloudy',
    cloudDensity: 0.7,
    syncToRealTime: true,
  }
}

Display -> Controller: HeartbeatStatus (periodic, ~10s)
{
  displayId: 1,
  group: 'left-bank',
  currentScene: 'default-flight',
  fps: 30,
  memoryMB: 450,
  uptime: 86400,
}
```

This is NOT frame-level state sync. The controller sends high-level commands; displays execute them autonomously. If the WebSocket drops, the display continues with its current scene.

#### Critical Decision: Same Codebase

One SvelteKit app serves:
- `GET /` -- standalone mode (current behavior, unchanged)
- `GET /display/1` -- remote-controlled display mode
- `GET /controller` -- dashboard to manage all displays
- `POST /api/scene` -- REST API for external integrations
- `WS /ws` -- WebSocket for real-time state sync

Same types, same components, same build. Different routes, different behavior.

---

### 2. Product Designer: UX + Content Model

#### Core Insight: The user-facing concept is "Scenes", not settings.

The current model (locations + weather + time) is the right *vocabulary*. But the *grammar* should be scenes -- named, authored, scheduled experiences.

#### Scene Definition

```typescript
interface Scene {
  id: string;
  name: string;                    // "Morning Over Dubai"
  description?: string;
  
  // What to render
  base: SceneBase;                 // The primary content
  overlays?: OverlayConfig[];      // Additional CSS/video layers
  
  // When to show
  schedule?: SceneSchedule;
  
  // How long
  duration?: number;               // seconds. undefined = until next scene
}

interface SceneBase {
  type: 'terrain' | 'video' | 'static';
  
  // For type: 'terrain' (live Cesium)
  location?: LocationId;
  weather?: WeatherType;
  cloudDensity?: number;
  syncToRealTime?: boolean;
  
  // For type: 'video' (pre-rendered)
  videoSrc?: string;               // path to HEVC file
  loop?: boolean;
  
  // For type: 'static' (image/gradient)
  imageSrc?: string;
  background?: string;             // CSS gradient
}

interface OverlayConfig {
  id: string;                      // 'snowfall' | 'santa' | 'fireworks'
  component: string;               // Svelte component name in registry
  params?: Record<string, unknown>;
  zIndex: number;
}

interface SceneSchedule {
  // Recurring dates (MM-DD format)
  startDate?: string;              // "12-20"
  endDate?: string;                // "12-26"
  
  // Time of day (24h)
  timeRange?: [number, number];    // [18, 23.5]
  
  // Days of week
  days?: number[];                 // [1,2,3,4,5] = weekdays
  
  // Priority (higher wins when multiple match)
  priority?: number;
}
```

#### Worked Example: "Santa Flies By at Christmas"

**scene.json:**
```json
{
  "id": "christmas-santa",
  "name": "Christmas Eve",
  "base": {
    "type": "terrain",
    "location": "dubai",
    "weather": "clear",
    "syncToRealTime": true
  },
  "overlays": [
    {
      "id": "snowfall",
      "component": "SnowOverlay",
      "zIndex": 3
    },
    {
      "id": "santa",
      "component": "SantaFlyby",
      "params": { "interval": 300 },
      "zIndex": 4
    }
  ],
  "schedule": {
    "startDate": "12-20",
    "endDate": "12-26",
    "timeRange": [17, 23.5],
    "priority": 10
  }
}
```

**SantaFlyby.svelte:**
```svelte
<script lang="ts">
  // A CSS-animated Santa silhouette that crosses the window every N seconds
  let { interval = 300 } = $props();
  let visible = $state(false);
  
  $effect(() => {
    const timer = setInterval(() => {
      visible = true;
      setTimeout(() => visible = false, 8000);
    }, interval * 1000);
    return () => clearInterval(timer);
  });
</script>

{#if visible}
  <div class="santa-track">
    <div class="santa">🛷</div>
  </div>
{/if}

<style>
  .santa-track {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }
  .santa {
    position: absolute;
    top: 15%;
    font-size: 2rem;
    animation: fly-across 8s linear forwards;
  }
  @keyframes fly-across {
    from { transform: translate3d(-100%, 0, 0); }
    to { transform: translate3d(calc(100vw + 100%), 0, 0); }
  }
</style>
```

**Deployment:** `git push`. The scene is compiled at build time like any other Svelte component. No runtime loading.

#### Multi-Display Grouping

```
6 physical windows in office:
  +-----+ +-----+ +-----+
  |  1  | |  2  | |  3  |   <-- Group: "left-bank"
  +-----+ +-----+ +-----+
  +-----+ +-----+ +-----+
  |  4  | |  5  | |  6  |   <-- Group: "right-bank"
  +-----+ +-----+ +-----+

Groups share a scene. Camera offset creates parallax:
  Display 1: lon - 0.01  (looking slightly left)
  Display 2: lon + 0.00  (looking straight)
  Display 3: lon + 0.01  (looking slightly right)
```

Each display's `WindowModel` receives the same scene but applies a `lonOffset` based on its position in the group. This creates the illusion of looking through adjacent airplane windows at the same landscape.

---

### 3. Pragmatic Developer: Feasibility

#### Core Insight: The current codebase is 90% of what you need. The missing 10% is coordination, not rendering.

#### What Already Works (Do Not Touch)

| Component | Why It Works |
|-----------|-------------|
| WindowModel | Already serializable. Already has setters. |
| ViewState | Pure derived. Will work identically with remote state. |
| Window.svelte | Layer compositor pattern is extensible. |
| CesiumViewer | HMR-safe, terrain/buildings/night working. |
| CSS layers | Performant on any GPU. Easy to add new ones. |

#### What Needs to Be Added

| Feature | Complexity | Lines (est.) |
|---------|-----------|-------------|
| `WindowModel.applyPatch()` | Trivial | ~30 |
| WebSocket server (hooks.server.ts) | Low | ~100 |
| WebSocket client (display mode) | Low | ~80 |
| Scene type definitions | Trivial | ~50 |
| SceneScheduler | Medium | ~150 |
| `/display/[id]` route | Low | ~60 |
| `/controller` route + UI | Medium | ~400 |
| `/api/scene` endpoint | Low | ~50 |
| `/api/health` endpoint | Trivial | ~30 |
| **Total new code** | | **~950 lines** |

This is roughly half the size of the existing codebase. Buildable in 2-3 weeks.

#### Pi 5 Reality Check

| Resource | Budget | Cesium Live | Video Mode |
|----------|--------|-------------|------------|
| VRAM | 256MB shared | ~200MB | ~30MB |
| RAM | 8GB | ~500MB | ~200MB |
| CPU | 4-core Cortex-A76 | 2 cores (WebGL + JS) | 0.5 core (HW decode) |
| GPU | VideoCore VII | WebGL rendering | H.265 HW decode |
| Target FPS | 30 | Achievable at 1080p* | 60fps trivial |
| Thermal | Passive w/ heatsink | Sustained OK with case | Cool |

*Cesium at 1080p on Pi 5: needs validation. `requestRenderMode: true` is the escape valve (render only on camera change, not every frame). Current code has it set to `false`.

#### Resource Budget Per Display (Cesium mode)

```
Cesium WebGL context:  ~200MB VRAM, ~300MB RAM
CSS compositor layers: <10MB
SvelteKit runtime:     ~30MB RAM
WebSocket client:      ~1MB RAM
-----------------------------------------
Total:                 ~540MB of 8GB RAM
```

Comfortable headroom. No memory pressure.

---

### 4. DevOps/Fleet: Deployment + Reliability

#### Core Insight: 6 Pis are a fleet. Fleet management is the hidden complexity.

#### Per-Pi Setup

```bash
# /opt/aero-window/fleet/setup-pi.sh
#!/bin/bash
# Run once per Pi

# Install Node.js 25.x
curl -fsSL https://deb.nodesource.com/setup_25.x | sudo bash -
sudo apt-get install -y nodejs chromium-browser

# Clone app
git clone https://github.com/yourrepo/aero-window.git /opt/aero-window

# Configure display identity
echo "DISPLAY_ID=1" > /opt/aero-window/.env.local
echo "DISPLAY_GROUP=left-bank" >> /opt/aero-window/.env.local
echo "CONTROLLER_URL=ws://192.168.1.100:3000/ws" >> /opt/aero-window/.env.local

# Build
cd /opt/aero-window && npm ci && npm run build

# Install systemd service
sudo cp fleet/aero-window.service /etc/systemd/system/
sudo systemctl enable aero-window
sudo systemctl start aero-window
```

#### Systemd Service

```ini
# fleet/aero-window.service
[Unit]
Description=Aero Dynamic Window
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/opt/aero-window
ExecStart=/usr/bin/chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-translate \
  --disable-infobars \
  --no-first-run \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --enable-features=OverlayScrollbar \
  --start-fullscreen \
  --autoplay-policy=no-user-gesture-required \
  http://localhost:3000/display/${DISPLAY_ID}
Restart=always
RestartSec=5
Environment=DISPLAY=:0

[Install]
WantedBy=graphical.target
```

#### Fleet Update

```bash
# fleet/update-fleet.sh
#!/bin/bash
# Run from developer laptop to push updates to all Pis

HOSTS="pi1 pi2 pi3 pi4 pi5 pi6"

for host in $HOSTS; do
  echo "Updating $host..."
  ssh pi@$host "cd /opt/aero-window && git pull && npm ci && npm run build && sudo systemctl restart aero-window" &
done

wait
echo "All displays updated."
```

#### Resilience

| Failure | Mitigation |
|---------|-----------|
| Controller Pi dies | Displays continue with last-known scene (localStorage persistence). |
| WebSocket disconnects | Client reconnects with exponential backoff (1s, 2s, 4s, 8s, max 30s). |
| Chromium crashes | systemd `Restart=always` restarts within 5 seconds. |
| Chromium freezes | Watchdog: cron job checks `/api/health` every 60s, restarts if no response. |
| Network outage | Cesium tiles are cached. Displays run autonomously. |
| Power cycle | systemd auto-starts on boot. App loads last scene from localStorage. |

#### Networking

```
Office LAN (Ethernet recommended):
  192.168.1.100 - Pi 1 (Controller + Display 1)
  192.168.1.101 - Pi 2 (Display 2)
  192.168.1.102 - Pi 3 (Display 3)
  192.168.1.103 - Pi 4 (Display 4)
  192.168.1.104 - Pi 5 (Display 5)
  192.168.1.105 - Pi 6 (Display 6)
```

Static IPs via `/etc/dhcpcd.conf`. No mDNS, no DNS dependency. For 6 devices, simplicity wins.

Controller Pi serves both the controller UI AND its own display. No dedicated controller hardware.

---

### 5. Creative Director: 10x Thinking

#### Core Insight: The real product is a programmable ambient display platform. The airplane window is the first "app."

The hybrid architecture (live terrain + CSS overlays + optional video) is genuinely novel in the digital signage space. Most solutions are either dumb video playback (no interactivity, no time-awareness) or complex live rendering (expensive, unreliable). This project sits in the sweet spot.

#### Beyond the Window

The scene system naturally supports non-window content:

| Scene | Description | Implementation |
|-------|-------------|---------------|
| Meeting mode | "Occupied until 2:30 PM" over calm sky | Static overlay + terrain background |
| Weather mirror | Show actual weather from office city | Weather API -> model.weather |
| Celebration | Team achievement fireworks | Fireworks overlay + notification |
| Focus mode | Dim night sky, minimal motion | Scene with `timeOfDay: 22`, low brightness |
| Welcome | "Good morning, [Team]!" on dawn sky | Text overlay with schedule |
| Dashboard | Live metrics on translucent overlay | Overlay component pulling API data |

These are all just scenes with different overlay components. The architecture does not change.

#### Calendar-Aware Intelligence

The scene scheduler does not need AI. It needs a simple rule engine:

```json
{
  "rules": [
    { "match": { "date": "12-25" }, "scene": "christmas-morning", "priority": 100 },
    { "match": { "date": "01-26" }, "scene": "republic-day", "priority": 100 },
    { "match": { "dayOfWeek": [6, 0] }, "scene": "weekend-calm", "priority": 5 },
    { "match": { "timeRange": [22, 6] }, "scene": "night-screensaver", "priority": 3 },
    { "match": { "timeRange": [6, 9] }, "scene": "morning-energy", "priority": 2 },
    { "match": {}, "scene": "default-flight", "priority": 0 }
  ]
}
```

Highest-priority matching rule wins. Dead simple. Debuggable. No machine learning.

#### Content Pipeline

```
Author (developer):
  Write scene.json + optional Svelte overlay component
  
Package:
  Drop into src/lib/scenes/[scene-name]/
  Register in src/lib/scenes/registry.ts
  
Test:
  npm run dev -> localhost:5173 -> manually load scene via Controls
  
Deploy:
  git push -> fleet update script -> all Pis rebuild
  
Timeline:
  New CSS overlay scene: 1-2 hours
  New video scene: 4-8 hours (record/render + package)
  New Cesium location: 30 minutes (add to LOCATIONS array)
```

---

## Council Deliberation

### Universal Agreement

1. **Controller is a SvelteKit route, not a separate service.** One codebase, one deployment, one type system. For a team of 1, this is non-negotiable.

2. **WebSocket state sync with JSON commands.** Not frame-level sync. Controller sends scene commands; displays execute autonomously.

3. **Scenes are the authoring unit.** Named, scheduled, compositable.

4. **Scenes are build-time artifacts.** Svelte components + JSON in a directory. Deployed via git push. No runtime plugin loading.

5. **Each display functions independently.** If the controller dies, displays continue. Resilience over coordination.

6. **Do not abstract render backends.** Use Cesium, CSS, and `<video>` directly. No common interface.

### Key Trade-off Resolution

**Extensibility vs. Simplicity:** The scene model is the resolution. Scenes are extensible (new Svelte components in a directory) without requiring infrastructure (no plugin loader, no dynamic imports, no marketplace). The "extensibility" is that a developer who knows CSS can create a new effect in an hour.

### Dealbreaker Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Cesium on Pi 5 too slow | Medium | High | Phase 0 validation. Fallback: requestRenderMode, 720p, or video-first. |
| 6 Cesium instances flooding LAN with tile requests | Low | Medium | Stagger scene transitions. Local tile cache on controller. |
| WebSocket unreliability | Low (wired) | Low | Reconnection + localStorage persistence. |
| Build time on Pi 5 too long | Low | Low | Build on laptop, rsync output. |

---

## Recommended Architecture

### Directory Structure

```
aero-window/
├── src/
│   ├── lib/
│   │   ├── core/                        # UNCHANGED
│   │   │   ├── WindowModel.svelte.ts    # + applyPatch() method
│   │   │   ├── ViewState.svelte.ts
│   │   │   ├── types.ts                 # + Scene, LayerConfig types
│   │   │   ├── constants.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── layers/                      # UNCHANGED (render components)
│   │   │   ├── Window.svelte            # + scene-aware layer composition
│   │   │   ├── CesiumViewer.svelte
│   │   │   ├── CloudLayer.svelte
│   │   │   ├── CityLightsLayer.svelte
│   │   │   ├── WeatherLayer.svelte
│   │   │   └── VideoLayer.svelte        # NEW (Phase 5)
│   │   │
│   │   ├── scenes/                      # NEW (Phase 1)
│   │   │   ├── registry.ts             # Build-time scene manifest
│   │   │   ├── default-flight/
│   │   │   │   └── scene.json
│   │   │   ├── christmas-eve/
│   │   │   │   ├── scene.json
│   │   │   │   ├── SnowOverlay.svelte
│   │   │   │   └── SantaFlyby.svelte
│   │   │   └── night-screensaver/
│   │   │       └── scene.json
│   │   │
│   │   ├── sync/                        # NEW (Phase 2)
│   │   │   ├── ws-client.ts            # Display-side WebSocket
│   │   │   ├── ws-server.ts            # Controller-side WebSocket broker
│   │   │   └── types.ts               # Command/status message types
│   │   │
│   │   └── scheduler/                   # NEW (Phase 1)
│   │       ├── SceneScheduler.ts       # Calendar + time rule engine
│   │       └── schedule.json           # The actual schedule rules
│   │
│   ├── routes/
│   │   ├── +page.svelte                # Standalone mode (UNCHANGED)
│   │   ├── +layout.svelte
│   │   │
│   │   ├── display/                    # NEW (Phase 2)
│   │   │   └── [id]/
│   │   │       └── +page.svelte       # Remote-controlled display
│   │   │
│   │   ├── controller/                 # NEW (Phase 2)
│   │   │   └── +page.svelte           # Fleet management dashboard
│   │   │
│   │   └── api/                        # NEW (Phase 4)
│   │       ├── health/+server.ts
│   │       └── scene/+server.ts
│   │
│   └── hooks.server.ts                 # NEW (Phase 2) - WebSocket upgrade
│
├── fleet/                              # NEW (Phase 2)
│   ├── setup-pi.sh
│   ├── update-fleet.sh
│   └── aero-window.service
│
├── docs/
│   ├── ARCHITECTURE.md                 # Existing (update after implementation)
│   ├── ARCHITECTURE_V2_COUNCIL.md      # This document
│   └── VISION.md                       # Existing
│
└── package.json
```

---

## Implementation Phases

### Phase 0: Validate Pi 5 Performance (1 day)

**Goal:** Confirm Cesium viability on target hardware before committing to architecture.

**Tasks:**
- [ ] Deploy current codebase to a single Pi 5
- [ ] Measure: FPS at 1080p, RAM usage, tile load time, thermal behavior
- [ ] Test with `requestRenderMode: true` (render on change only)
- [ ] Test at 720p if 1080p is insufficient
- [ ] Document results

**Gate:** If Cesium cannot sustain 20+ FPS at 720p, the architecture shifts to video-first with Cesium as a content creation tool rather than a live renderer.

**Value delivered:** De-risked hardware decision.

---

### Phase 1: Scene Model + Scheduler (1 week)

**Goal:** Replace hardcoded auto-cycle with a calendar-aware scene system.

**Tasks:**
- [ ] Define `Scene`, `SceneBase`, `OverlayConfig`, `SceneSchedule` types in `types.ts`
- [ ] Create `SceneScheduler.ts` with rule-matching engine
- [ ] Create `schedule.json` with default rules (time-of-day scenes, weekday/weekend)
- [ ] Create `scenes/registry.ts` that exports all scene definitions
- [ ] Create 3-4 initial scenes: `default-flight`, `morning-energy`, `night-calm`, `weekend-nature`
- [ ] Refactor `Window.svelte` to accept a scene config instead of hardcoded auto-cycle
- [ ] Wire scheduler into standalone mode (`+page.svelte`)

**Value delivered:** The single display becomes calendar-aware. Shows different content at different times. The "dumb loop" becomes an intelligent scheduler.

**Standalone mode still works.** No multi-display code yet.

---

### Phase 2: WebSocket State Sync + Multi-Display (1.5 weeks)

**Goal:** Two or more Pis showing synchronized content controlled by a dashboard.

**Tasks:**
- [ ] Add `applyPatch(state: Partial<ModelState>)` to WindowModel
- [ ] Create `hooks.server.ts` with WebSocket upgrade handler
- [ ] Create `sync/ws-server.ts` (broadcasts scene commands to connected displays)
- [ ] Create `sync/ws-client.ts` (receives commands, applies to local model, auto-reconnects)
- [ ] Create `/display/[id]/+page.svelte` (display mode: receives state, renders, no local scheduling)
- [ ] Create `/controller/+page.svelte` (shows connected displays, scene selector, manual overrides)
- [ ] Create `fleet/setup-pi.sh` and `fleet/aero-window.service`
- [ ] Test with 2 Pis

**Value delivered:** Working multi-display setup. One controller, N displays. Scene changes propagate instantly.

---

### Phase 3: Display Groups + Camera Offset (3 days)

**Goal:** Adjacent windows show parallax of the same landscape.

**Tasks:**
- [ ] Add `group` and `positionInGroup` to display config
- [ ] Compute `lonOffset` from position: `(positionInGroup - centerIndex) * PARALLAX_DEGREES`
- [ ] Apply offset in display's CesiumViewer camera sync
- [ ] Add group management to controller UI (drag displays into groups)
- [ ] Test with 3 Pis in a group

**Value delivered:** The "row of windows" illusion. Three adjacent screens look like three airplane windows viewing the same landscape from different angles.

---

### Phase 4: REST API + External Integration (3 days)

**Goal:** Other systems can control the displays.

**Tasks:**
- [ ] `GET /api/health` - returns all display statuses
- [ ] `GET /api/scene` - returns current scene for each display
- [ ] `POST /api/scene` - set scene for a display or group `{ displayId?: number, group?: string, sceneId: string }`
- [ ] `POST /api/command` - send raw model commands `{ command: 'setWeather', params: { weather: 'storm' } }`
- [ ] Document API in `docs/API.md`

**Value delivered:** "Hey Google, show me the Himalayas" via HTTP webhook. Home Assistant integration. Webhook-triggered celebrations.

---

### Phase 5: Video Layer + Pre-Rendered Content (1 week)

**Goal:** Support pre-rendered video as an alternative to live Cesium.

**Tasks:**
- [ ] Create `VideoLayer.svelte` (plays HEVC in a z-indexed layer, same pattern as CloudLayer)
- [ ] Add `type: 'video'` scene base support in Window.svelte
- [ ] Create a recording pipeline: Cesium -> screen capture -> HEVC encode -> scene package
- [ ] Create 2-3 video scenes (dramatic flyovers too GPU-intensive for live Pi rendering)
- [ ] Test video playback on Pi 5 (hardware H.265 decode)

**Value delivered:** Content that would be too expensive for live rendering can be pre-recorded. Santa flyby as a short video loop. Dramatic aerial sequences. Pi GPU stays cool.

---

### Phase 6: Content Authoring Sprint (ongoing)

**Goal:** Build a library of scenes that make the installation genuinely delightful.

**Seasonal scenes:**
- [ ] Christmas: Snow overlay + Santa flyby + London/NYC terrain
- [ ] Diwali: Fireworks overlay + Mumbai night scene
- [ ] Republic Day: Indian flag colors in sky gradients
- [ ] Holi: Color splash overlay effects
- [ ] New Year: Countdown + fireworks

**Ambient scenes:**
- [ ] Morning energy: Bright day, clouds, moderate altitude
- [ ] Focus mode: Night sky, minimal motion, dim
- [ ] Storm watch: Dramatic weather, lightning, turbulence
- [ ] Sunset cruise: Perpetual golden hour

**Utility scenes:**
- [ ] Meeting room occupied: Calm background + text overlay
- [ ] Welcome message: "Good morning, [Team]" + dawn sky
- [ ] Celebration: "[Name] birthday!" + confetti overlay

**Value delivered:** The system earns its keep as an office amenity.

---

## What to AVOID

### 1. Do Not Build a Plugin Loader
Dynamic imports of untrusted code at runtime add security risk, error handling complexity, and debugging difficulty. Scenes are Svelte components compiled at build time. "Extensible" means "add a file to a directory and rebuild."

### 2. Do Not Build a Render Backend Abstraction
```typescript
// DO NOT BUILD THIS
interface RenderBackend {
  init(container: HTMLElement): void;
  render(scene: Scene): void;
  dispose(): void;
}
```
Cesium, CSS, and `<video>` have entirely different APIs. An abstraction hides the power of each tool. Use them directly. If a scene uses video, it has a `<video>` element. If it uses Cesium, it uses CesiumViewer. No indirection.

### 3. Do Not Build a Scene Editor UI
The controller should let you *select* and *assign* scenes. It should not let you *create* scenes visually. Scene authoring happens in code. A WYSIWYG scene editor for a team of 1 is pure overhead with no users.

### 4. Do Not Use Message Brokers (MQTT, Redis, RabbitMQ)
WebSocket between 7 devices on a LAN is trivially sufficient. Adding infrastructure components adds deployment complexity, failure modes, and operational burden.

### 5. Do Not Split Into Microservices
One SvelteKit app. One repository. One deployment. The "controller" and "display" are routes, not services.

### 6. Do Not Build Face Tracking or Voice Control Now
These require cameras, microphones, and ML inference. The architecture does not need to accommodate them yet -- they are future "input sources" that produce the same scene-change HTTP requests as any other integration.

### 7. Do Not Over-Type the Scene Params
Start with `Record<string, unknown>` for scene-specific parameters. Tighten types as patterns emerge after 10+ scenes are authored. Premature typing constrains what scenes can express.

---

## Revisit Conditions

Reopen this architecture discussion if:

| Condition | Why It Matters |
|-----------|---------------|
| Pi 5 cannot run CesiumJS at acceptable quality | Architecture shifts to video-first |
| Display count exceeds 12 | May need dedicated controller hardware |
| A second developer joins | Can justify more infrastructure and abstraction |
| Scene authoring is a bottleneck | May justify a visual editor |
| Office network is unreliable Wi-Fi | May need local-first with eventual sync |
| Real-time interaction is needed (face tracking) | May need dedicated Pi for ML inference |

---

## Summary

The path from single-display to 6-display platform is approximately 950 lines of new code across 6 phases. The key insight is that the current WindowModel is already a serializable state object -- multi-display coordination is a thin WebSocket layer on top of what exists, not a rewrite.

The architecture avoids overengineering by refusing to build abstractions before they are needed: no plugin system, no render backend interface, no scene editor, no message broker. Extensibility comes from the simplicity of the content model (scenes are Svelte components in a directory) and the openness of the API (REST + WebSocket).

Ship Phase 0 first. Everything else depends on whether Cesium works on Pi 5.
