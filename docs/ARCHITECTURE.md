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

## Hybrid Layered Compositing (3D + CSS)

```
┌─────────────────────────────────────────┐
│ CSS: UI Controls (dev only)         z:60│
├─────────────────────────────────────────┤
│ CSS: Window Frame (static)          z:50│
├─────────────────────────────────────────┤
│ CSS: Blind (animated)               z:40│
├─────────────────────────────────────────┤
│ CSS: Events (Santa, birds...)       z:25│
├─────────────────────────────────────────┤
│ THRELTE CANVAS (3D scene)           z:0 │
│  ├── Sky3D (gradient shader sphere)     │
│  ├── Clouds3D (drifting 3D planes)      │
│  └── Ground3D (parallax terrain layers) │
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
// src/lib/core/state.svelte.ts
class WindowState {
  // Time (circadian sync)
  timeOfDay = $state(getCurrentTimeOfDay());  // 0-24, from system clock
  skyState = $derived(getSkyState(this.timeOfDay));  // 'night' | 'dawn' | 'day' | 'dusk'

  // View
  blindOpen = $state(true);
  currentView = $state<ViewType>('dubai');
  viewAngle = $state<ViewAngle>('right');  // Camera/seat position
  skyRatio = $derived(...);  // Adjusts based on viewAngle

  // Events
  activeEvent = $state<EventType>(null);

  // Methods
  toggleBlind(): void;
  setView(view: ViewType): void;
  setViewAngle(angle: ViewAngle): void;
  triggerEvent(event: EventType): void;
}

type ViewType = 'dubai' | 'himalayas' | 'mumbai' | 'ocean' | 'desert' | 'clouds';
type ViewAngle = 'left' | 'right' | 'down' | 'forward';
type EventType = 'christmas' | 'diwali' | 'newyear' | 'birds' | 'storm' | null;
type SkyState = 'night' | 'dawn' | 'day' | 'dusk';
```

## Directory Structure (Implemented)

```
/src
  /lib
    /core                # Core state management
      state.svelte.ts    # WindowState class with Svelte 5 runes

    /layers              # Visual layer components
      Window.svelte      # Hybrid compositor: 3D canvas + CSS overlays
      Scene3D.svelte     # Threlte scene orchestrator
      Events.svelte      # CSS event overlays (Santa, birds, etc.)
      Controls.svelte    # Dev controls panel
      /3d                # Three.js/Threlte 3D components
        Sky3D.svelte     # Shader-based sky sphere with stars
        Ground3D.svelte  # Multi-layer parallax terrain
        Clouds3D.svelte  # Drifting 3D cloud planes

    /events              # Event system configuration
      index.ts           # Event configs and date checking

    /views               # View configurations
      index.ts           # ViewConfig for each destination

    /assets              # Static assets
    /server              # Server-side code

  /routes
    +page.svelte         # Main entry point
    +layout.svelte       # App layout

  /static
    /videos              # Video textures (future: aerial footage)
    /images              # Fallback images
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
