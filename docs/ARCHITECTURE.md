# Aero Dynamic Window - Architecture

## Vision

A circadian-aware digital window installation for South West office (India).
Displays dynamic airplane window views that:
- Sync with real time of day (circadian rhythm for employee wellbeing)
- Show variety (cities, mountains, oceans, clouds)
- Surprise with events (Christmas Santa, Diwali fireworks, etc.)
- Run efficiently on Raspberry Pi + headless browser

## Physical Setup

```
Screen (Portrait/Landscape) + Raspberry Pi 4/5
├── Headless Chromium (kiosk mode)
├── Local asset cache
├── USB fallback (pre-rendered videos)
└── Remote stream capability (optional)
```

## Hybrid Layered Compositing (Cesium + Three.js + CSS)

```
┌─────────────────────────────────────────┐
│ CSS: UI Controls (dev only)         z:60│
├─────────────────────────────────────────┤
│ CSS: Window Frame (static)          z:50│
├─────────────────────────────────────────┤
│ CSS: Blind (animated)               z:40│
├─────────────────────────────────────────┤
│ CSS: Vignette overlay               z:20│
├─────────────────────────────────────────┤
│ THREE.JS OVERLAY (transparent)       z:2│
│  ├── VolumetricClouds (3D positioned)   │
│  ├── WeatherEffects (rain, lightning)   │
│  └── Float (camera turbulence)          │
├─────────────────────────────────────────┤
│ CESIUM VIEWER (terrain + buildings)  z:1│
│  ├── Ion terrain + imagery              │
│  ├── NASA night lights layer            │
│  ├── OSM 3D buildings                   │
│  └── Atmosphere + time-of-day lighting  │
└─────────────────────────────────────────┘
```

**Benefits of Hybrid Approach:**
- True 3D depth and parallax when view angle changes
- Smooth shader-based sky gradients
- Volumetric cloud feel with 3D planes
- CSS simplicity for frame, blind, and event overlays
- Best of both worlds: realism + maintainability

## Core State (Implemented)

```typescript
// src/lib/core/WindowModel.svelte.ts
class WindowModel {
  // Position
  lat = $state(25.2048);
  lon = $state(55.2708);
  utcOffset = $state(4);  // Hours from UTC
  altitude = $state(35000);
  heading = $state(45);

  // Time (circadian sync)
  timeOfDay = $state(12);  // 0-24, syncs with system clock
  syncToRealTime = $state(true);
  localTimeOfDay = $derived(...);  // Adjusted for location timezone
  skyState = $derived(getSkyState(this.localTimeOfDay));

  // Location
  location = $state<LocationId>('dubai');

  // Environment
  weather = $state<WeatherType>('cloudy');
  cloudDensity = $state(0.7);
  cloudSpeed = $state(0.4);   // Drift speed multiplier
  cloudScale = $state(1.5);   // Cloud size multiplier

  // View toggles
  blindOpen = $state(true);
  showBuildings = $state(true);
  showClouds = $state(true);

  // Methods
  setLocation(id: LocationId): void;
  setTime(hours: number): void;
  setAltitude(feet: number): void;
  toggleBlind(): void;
  flyTo(locationId: LocationId): Promise<void>;  // Animated transition
  tick(delta: number): void;  // Animation frame update
}

type LocationId = 'dubai' | 'himalayas' | 'mumbai' | 'ocean' | 'desert' | 'clouds' | 'hyderabad' | 'dallas' | 'phoenix' | 'las_vegas';
type WeatherType = 'clear' | 'cloudy' | 'overcast' | 'storm';
type SkyState = 'night' | 'dawn' | 'day' | 'dusk';
```

## Directory Structure (Implemented)

```
/src
  /lib
    /core                    # Core state management
      WindowModel.svelte.ts  # Central state class with Svelte 5 runes
      EnvironmentSystem.ts   # Time-of-day, biome colors
      constants.ts           # All magic numbers centralized
      types.ts               # TypeScript type definitions
      index.ts               # Public exports

    /layers                  # Visual layer components
      Window.svelte          # Layer compositor: Cesium + Three.js + CSS
      CesiumViewer.svelte    # Cesium terrain, buildings, atmosphere
      Scene3DOverlay.svelte  # Threlte canvas (transparent overlay)
      Controls.svelte        # Dev controls panel

      /3d                    # Three.js/Threlte 3D components
        Scene.svelte         # Main 3D scene orchestrator
        VolumetricClouds.svelte  # 3D positioned shader clouds
        WeatherEffects.svelte    # Rain, lightning effects
        EnhancedWing.svelte      # Aircraft wing model
        CityLights.svelte        # Point cloud city lights

    /plugins                 # Threlte plugins
      turbulence.ts          # Camera shake plugin
      daynight.ts            # Material time-of-day adjustments

    /shaders                 # GLSL shader code
      index.ts               # Shader exports

  /routes
    +page.svelte             # Main entry point

  /static
    /models                  # 3D models (GLTF)
```

## Video Texture Strategy

### Sky Layer
- 4 seamless loops: dawn (5-8), day (8-17), dusk (17-20), night (20-5)
- Crossfade between based on timeOfDay
- Fallback: CSS gradient

### Ground Layer
- Multiple view videos at different "altitudes"
- Slight parallax movement (subtle drift)
- Videos: Dubai skyline, Himalayan peaks, Mumbai coast, etc.

### Clouds Layer
- Optional semi-transparent video overlay
- Or: Simple particle system
- Can be toggled based on "weather"

### Events Layer
- Sprite animations or video overlays
- Triggered by date/time or random chance
- Christmas (Dec 20-26): Santa sleigh
- Diwali: Fireworks at night
- Random: Birds flying by

## Circadian Time Sync

```typescript
// Simple real-time sync
function getTimeOfDay(): number {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60;
}

// Sky state based on time
function getSkyState(time: number): 'night' | 'dawn' | 'day' | 'dusk' {
  if (time < 5 || time >= 20) return 'night';
  if (time < 8) return 'dawn';
  if (time < 17) return 'day';
  return 'dusk';
}
```

## View Rotation

```typescript
// Change view every N hours to prevent monotony
const VIEW_ROTATION_HOURS = 2;
const VIEWS: ViewType[] = ['dubai', 'himalayas', 'mumbai', 'ocean', 'desert'];

function scheduleViewRotation() {
  setInterval(() => {
    const nextView = VIEWS[Math.floor(Math.random() * VIEWS.length)];
    state.currentView = nextView;
  }, VIEW_ROTATION_HOURS * 60 * 60 * 1000);
}
```

## Event System

```typescript
interface EventConfig {
  id: string;
  name: string;
  startDate: { month: number; day: number };
  endDate: { month: number; day: number };
  timeRange?: { start: number; end: number }; // Hours
  probability?: number; // For random events like birds
}

const EVENTS: EventConfig[] = [
  { id: 'christmas', name: 'Santa', startDate: {month: 12, day: 20}, endDate: {month: 12, day: 26} },
  { id: 'diwali', name: 'Fireworks', startDate: {month: 10, day: 28}, endDate: {month: 11, day: 5} },
  { id: 'birds', name: 'Birds', probability: 0.1 }, // 10% chance per hour
];
```

## Raspberry Pi Deployment

```bash
# /etc/systemd/system/aero-window.service
[Unit]
Description=Aero Dynamic Window
After=network.target

[Service]
ExecStart=/usr/bin/chromium-browser --kiosk --noerrdialogs \
  --disable-infobars --no-first-run \
  --enable-features=OverlayScrollbar \
  --start-fullscreen \
  http://localhost:3000
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

## Fallback Strategy

1. **Primary**: Stream from remote server (SvelteKit app)
2. **Secondary**: Local cached videos
3. **Tertiary**: USB drive with static video loops
4. **Ultimate**: CSS gradient sky + static wing image

## Performance Targets

- 30+ FPS on Raspberry Pi 4
- < 200MB RAM usage
- Video textures: 720p max for Pi, 1080p for desktop
- Lazy load non-visible layers

## Implementation Status

### ✅ Phase 1: Core Layers (COMPLETE)
- Sky layer with time-based gradients, stars, sun/moon
- Ground layer with parallax drift and atmosphere haze
- Clouds layer with configurable density
- Window frame and animated blind
- View angle support (left, right, down, forward)

### ✅ Phase 2: Time Sync (COMPLETE)
- Real-time circadian sync (timeOfDay from system clock)
- Sky state derived from time (night/dawn/day/dusk)
- Smooth gradient transitions

### ✅ Phase 3: Events System (COMPLETE)
- Event overlays: Christmas (Santa), Diwali/NewYear (fireworks), Birds, Storm
- Date-based activation ready
- Manual trigger via dev controls

### 🔲 Phase 4: Video Textures (NEXT)
- Replace CSS gradients with video backgrounds
- Sky: time-lapse loops
- Ground: aerial footage for each view
- Clouds: transparent overlays

### 🔲 Phase 5: Raspberry Pi Optimization
- Performance profiling
- Video compression optimization
- Kiosk mode configuration
