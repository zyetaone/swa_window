# Aero Window — Deep Codebase Analysis + Enhancement Strategy

> Written 2026-04-13. Covers: current architecture, what to make leaner, how to use Pi compute, hardware list, interactivity enhancements, and the multi-screen vision.

---

## 1. Current Codebase Shape

```
src/lib/ (5,915 lines across 25 files)
├── core/              (4 files, ~1,700 lines) — SSOT state, persistence, scenarios
│   ├── AeroWindow.svelte.ts   809 lines — THE model. 35 $state fields, 15 $derived, ~20 methods
│   ├── flight-scenarios.ts     484 lines — Location-specific flight patterns (data, not logic)
│   ├── ws-client.svelte.ts     211 lines — Fleet server WebSocket client
│   ├── overpass-client.ts      180 lines — OSM building data fetcher
│   ├── persistence.ts           77 lines — localStorage save/load
│   └── index.ts                 45 lines — Context provider
├── layers/            (10 files, ~3,500 lines) — Visual rendering
│   ├── Window.svelte           945 lines — Layer compositor + gestures + RAF loop
│   ├── SidePanel.svelte        707 lines — Settings UI (locations, weather, time, sliders)
│   ├── cesium/CesiumManager.ts 647 lines — Cesium init, imagery, terrain, buildings, post-processing
│   ├── CesiumViewer.svelte     246 lines — Thin wrapper mounting CesiumManager
│   ├── Controls.svelte         269 lines — HUD overlay
│   ├── CloudBlobs.svelte       167 lines — SVG feTurbulence clouds
│   ├── cesium-shaders.ts        98 lines — GLSL color grading
│   ├── AirlineLoader.svelte     76 lines — Loading screen
│   └── controls/               190 lines — RangeSlider + Toggle components
├── shared/            (6 files, ~500 lines) — Types, constants, protocol
└── admin-store.svelte.ts  254 lines — Fleet admin transport
```

**Total: 5,915 lines.** For a product with Cesium terrain + 3D buildings + clouds + weather + day/night + flight sim + fleet management + admin panel + offline mode — this is lean. The z-ai-quiz codebase (a simpler product) is 8,800+ lines.

---

## 2. What to Make Leaner

### A. AeroWindow.svelte.ts (809 lines → target: 500)

The SSOT is doing too many things:
- Simulation state (position, time, weather, altitude, heading)
- Flight mode state machine (orbit, cruise_departure, cruise_transit)
- Tick methods (8 separate tick* functions)
- Director auto-pilot (location selection, flyTo orchestration)
- Micro-events (shooting stars, birds, contrails)
- User interaction override (8-second pause on input)
- Persistence (save/load)
- Atmospheric randomizer (cloud density shifts, haze shifts)
- Display mode (flight/screensaver/video)
- Fleet integration (applyPatch, displayMode, measuredFps)

**Refactor strategy using $state best practices:**

```typescript
// BEFORE: monolith
class AeroWindow {
    lat = $state(0);
    lon = $state(0);
    altitude = $state(35000);
    // ... 32 more $state fields
    // ... 20 methods
    // ... 8 tick functions
}

// AFTER: composition of focused modules
class FlightSim {
    position = $state.raw({ lat: 0, lon: 0 });  // $state.raw — reassigned, not mutated
    altitude = $state(35000);
    heading = $state(0);
    tick(dt: number): void { /* orbit/cruise physics only */ }
}

class AtmosphericModel {
    weather = $state<WeatherType>('clear');
    cloudDensity = $state(0.7);
    haze = $state(0.025);
    readonly effectiveCloudDensity = $derived.by(() => { /* ... */ });
    tick(dt: number): void { /* randomize cloud/haze shifts */ }
}

class Director {
    private model: FlightSim;
    pickNext(): LocationId { /* ... */ }
    flyTo(id: LocationId): void { /* ... */ }
    tick(dt: number): void { /* auto-pilot timer */ }
}

// Composed in a single SSOT that delegates
class AeroWindow {
    readonly flight = new FlightSim();
    readonly atmosphere = new AtmosphericModel();
    readonly director = new Director(this.flight);

    tick(dt: number): void {
        this.flight.tick(dt);
        this.atmosphere.tick(dt);
        this.director.tick(dt);
    }
}
```

**Key $state insight from the docs:** Class instances aren't proxified. Use `$state` in class fields for reactive properties, but use `$state.raw` for any field that's an external object (Cesium viewer, WebSocket, position tuples). The `$state.snapshot()` API is useful for persistence — snapshot the model to a plain object for localStorage.

### B. Window.svelte (945 lines → target: 600)

The compositor + gesture handler + RAF loop + all CSS in one file. Split into:
- `WindowCompositor.svelte` — the layer stack template + CSS (pure rendering)
- `GestureHandler.svelte` — touch/mouse/drag/swipe (or a reusable action)
- RAF loop stays in +page.svelte (already partly there)

### C. SidePanel.svelte (707 lines)

5 sections (locations, weather, time, flight, atmosphere) each ~140 lines. These are independent fieldsets. Could be split into sub-components, but it's also fine as-is — it's a settings panel, not logic.

### D. Dead code to remove

- `CloudCanvas.svelte` (if Minimax hasn't already)
- `cloud-shader.ts` (the old GLSL)
- `cloud-post-process.reference.ts` (nice reference but better as docs/)
- Any `@threlte` references (already removed from package.json)

---

## 3. How to Use Pi Compute More

The Pi 5 has:
- **4x Cortex-A76 @ 2.4GHz** — currently 11% CPU usage
- **16GB RAM** — currently 1.1GB used (7%)
- **VideoCore VII GPU, 512MB CMA** — currently doing WebGL
- **HEVC hardware decode** — unused
- **AI accelerator support** (via HAT) — unused

### Immediate GPU wins

1. **Increase CMA to 512MB** — ✅ DONE (this session)
2. **Enable force_turbo + gpu_freq=950** — waiting for fan
3. **OSM Buildings via 3D Tiles** — offloads building rendering to GPU's tile decoder instead of CPU-side GeoJSON extrusion
4. **Cesium fog + atmosphere** — enable `scene.fog` for free atmospheric perspective (GPU composited)

### Using the spare CPU

With 89% CPU idle, we can run:
- **Local Whisper tiny** (~75MB) for voice commands: "show me Dubai at sunset"
- **Phi-4-mini** (3.8B, ~2GB) for context: "what city is this?" → reads model.location → answers
- **Audio generation** via Pi's HDMI audio: ambient engine drone + weather sounds
- **Real weather API** polling: fetch actual weather for the current location every 10 min

### Using the spare RAM

With 14GB free:
- **Aggressive tile caching** — cache Cesium tiles in a RAM disk (`/dev/shm`) instead of SD card. 8GB RAM cache = instant tile loading, zero SD wear
- **Pre-render location screenshots** — render each location at key times (dawn/day/dusk/night) and cache as JPEG fallbacks for Level 2 degradation

---

## 4. Enhanced Interactivity

### Touchscreen (Waveshare 21.5")

The Waveshare 21.5" is USB HID — should be driver-free on Linux. Touch events flow as mouse events to Chromium. Our drag-blind gesture already works with touch.

**Enhancements:**
- **Swipe left/right** → fly to next/previous location (already partially wired)
- **Pinch zoom** → adjust altitude (Cesium supports this natively, but we override camera)
- **Long press on terrain** → show location info tooltip (Cesium's `scene.pick()`)
- **Two-finger rotate** → adjust heading (parallax clouds respond)

### Haptic feedback

The Pi 5 GPIO can drive a small haptic motor for:
- Turbulence rumble (synced with `model.motionOffsetY`)
- Landing gear thud on approach
- Blind snap feedback

### Sound design

HDMI audio out to a small speaker behind the wall:
- Ambient engine drone (loop, pitch varies with speed)
- Wind at altitude (volume varies with altitude)
- Rain on window (triggered by weather state)
- Cabin announcements (pre-recorded, triggered by Director on flyTo)

---

## 5. Multi-Screen Parallax Architecture

### The cylindrical sky concept

The sky + clouds form a 360° cylinder. Each screen shows a different angular slice:

```
Screen 0: heading offset = 0°
Screen 1: heading offset = 30°
Screen 2: heading offset = 60°
```

When the plane turns, all screens shift together but the offset creates parallax:
```
CloudBlobs receives: heading + (screenIndex * angularOffset)
Far clouds shift less per degree, near clouds shift more
→ Walking past the screens = looking at the same sky from different angles
```

### Implementation

Each display Pi loads:
```
http://master:5173?screen=1&totalScreens=3&server=ws://master:3001/ws
```

The `+page.svelte` reads these params and offsets the cloud heading:
```typescript
const screenIndex = parseInt(params.get('screen') || '0');
const totalScreens = parseInt(params.get('totalScreens') || '1');
const angularOffset = (screenIndex / totalScreens) * 60; // 60° total spread

// Pass to CloudBlobs:
<CloudBlobs heading={model.heading + angularOffset} ... />
```

Cesium camera also gets the offset for terrain parallax:
```typescript
viewer.camera.heading = model.heading + angularOffset * (Math.PI / 180);
```

### Sync via fleet server

The master Pi's fleet server broadcasts the current model state to all display Pis every frame via WebSocket. Each Pi applies the state + its screen offset. This keeps all screens in sync with sub-frame latency on a LAN.

---

## 6. Pi Hardware List (for 4-screen SWA installation)

| Item | Spec | Qty | Unit | Total |
|---|---|---|---|---|
| **Master Pi** | Pi 5 16GB (already have) | 1 | $0 | $0 |
| **Display Pis** | Pi 5 8GB | 3 | ~$80 | $240 |
| **Screens** | Waveshare 21.5" Touch (1080x1920) | 4 | ~$250 | $1,000 |
| **Network** | 5-port Gigabit switch | 1 | $10 | $10 |
| **Cables** | Cat6 Ethernet (1m) | 4 | $3 | $12 |
| **Cooling** | Pi 5 Active Cooler | 4 | $5 | $20 |
| **Storage** | 128GB SD A2 (master) | 1 | $15 | $15 |
| **Storage** | 32GB SD A1 (display) | 3 | $8 | $24 |
| **Audio** | Small speaker + 3.5mm cable | 1 | $10 | $10 |
| **Power** | USB-C PD 27W per Pi | 4 | $12 | $48 |
| **Mounting** | Wall brackets + bezels | 4 | $20 | $80 |
| | | | **TOTAL** | **~$1,459** |

Monthly: $0 (all self-hosted, free APIs)

### Pi 5 8GB vs alternatives for display nodes

| Option | RAM | GPU | WebGL2 | Cost | Verdict |
|---|---|---|---|---|---|
| Pi 5 8GB | 8GB | V3D 7.1 | Yes | $80 | ✅ Safe bet |
| Pi 5 4GB | 4GB | V3D 7.1 | Yes | $60 | ✅ Probably fine (Chromium uses ~750MB) |
| Pi 4 4GB | 4GB | V3D 4.2 | Yes (slower) | $55 | ⚠️ Slower GPU, may struggle with Cesium |
| Pi Zero 2 W | 512MB | V3D | WebGL1 only | $15 | ❌ Not enough for Cesium |

**Recommendation:** Pi 5 4GB for display nodes ($60 each, saves $60 total vs 8GB). They only run Chromium — 4GB is plenty.

---

## 7. Fallback System (graceful degradation)

```
Level 0: FULL (Cesium + live tiles + buildings + clouds + weather)
  ↓ Cesium Ion unreachable
Level 1: CACHED (Cesium + self-hosted tiles + buildings + clouds)
  ↓ WebGL init fails
Level 2: STATIC (pre-rendered location images + CSS clouds + CSS weather)
  ↓ images fail to load
Level 3: MINIMAL (CSS sky gradient + CSS clouds — the /playground route)
```

Detection: CesiumViewer already catches init failures. Add a `renderLevel` field to AeroWindow:
```typescript
renderLevel = $state<0 | 1 | 2 | 3>(0);
```

The admin panel shows which level each Pi is running at. The fleet server can alert when a Pi drops below Level 0.

---

## 8. Vault + Wiki Status

### What exists

- **MOC**: `1_Knowledge/maps/aero-window-moc.md` — comprehensive but last updated 2026-04-06
- **Project README**: `2_Work/zyeta/projects/Z_25_SouthWest_Hyderabad/aero-window/README.md`
- **Port plan**: `~/Documents/projects/zyeta/W_25_SOUTHWEST_HYDERABAD/aero-window/docs/port-plan-feat-offline-tiles-to-main.md`
- **Case study**: referenced in MOC but not read this session

### What needs updating

1. **MOC**: update status from "Pi 5 deployment validation pending" → "Pi 5 standalone auto-start deployed, fleet admin working, multi-screen vision designed"
2. **MOC architecture**: update from "GLSL shaders" → "SVG feTurbulence CSS clouds"
3. **MOC TODOs**: several are now done (Pi deployment, performance, locations expanded to 18)
4. **Case study**: needs the multi-screen installation narrative for CORENET 2026
5. **Wiki route**: no `/wiki` route exists in the app — the architecture page at `/architecture` serves as the in-app documentation

### Missing docs to write

- `docs/PI-SETUP.md` — complete Pi 5 kiosk setup guide (what we did today, reproducible)
- `docs/FLEET.md` — fleet server + admin panel usage guide
- `docs/MULTI-SCREEN.md` — the cylindrical parallax multi-Pi architecture
- Update `deploy/README.md` — add systemd service details from today's setup

---

## 9. The ES6 Class Refactor Rick Wants

Rick mentioned wanting a "modern ES6 class-based approach." The current AeroWindow IS already a class with $state fields — but it's a monolith. The refactor should:

1. **Split AeroWindow into composed classes** (FlightSim, AtmosphericModel, Director, MicroEvents)
2. **Use $state.raw for non-reactive data** (position tuples, Cesium objects, WebSocket)
3. **Use $state.snapshot() for persistence** instead of manual field-by-field serialization
4. **Use $derived.by() for all computed state** — the current model has some computed values as methods instead of derived
5. **Arrow functions for methods** used in event handlers (per Svelte 5 docs: "use arrow functions for methods to preserve `this` binding")

This is a 2-3 hour refactor that should reduce AeroWindow from 809 → ~500 lines while improving testability (each sub-class can be tested independently).

---

## 10. Priority Roadmap

| # | Task | Effort | Impact |
|---|---|---|---|
| 1 | Get the fan, enable GPU turbo | 5 min | Pi perf → 30fps |
| 2 | Re-enable OSM Buildings (3D Tiles, height-filtered) | 30 min | Visual wow |
| 3 | Tile caching for 10 SWA cities | 2 hr | $0/mo forever |
| 4 | AeroWindow class refactor | 2-3 hr | Code quality + testability |
| 5 | Multi-screen URL params + cloud parallax | 1-2 hr | Installation ready |
| 6 | Captive portal WiFi setup | 1 hr | Field deployment |
| 7 | Sound design (engine + weather loops) | 2-3 hr | Immersion |
| 8 | Touchscreen gesture enhancements | 1-2 hr | Interactivity |
| 9 | Whisper voice control | 2-3 hr | Wow factor |
| 10 | CORENET demo prep | 1 day | Business value |
