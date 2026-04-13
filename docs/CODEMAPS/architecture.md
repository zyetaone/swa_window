# Architecture Codemap

**Last Updated:** 2026-04-14

## Layer Diagram

```
                         DEPENDENCY LAYERS
 ════════════════════════════════════════════════════════

 ┌───────────────────────────────────────────────────────┐
 │  ROUTES                                               │
 │  +page.svelte — context provider + side-effects       │
 │  admin/  playground/  architecture/  api/              │
 └─────────────┬────────────────────────┬────────────────┘
               │                        │
               v                        v
 ┌─────────────────────┐    ┌───────────────────────────┐
 │  APP STATE           │    │  UI COMPONENTS            │
 │  app-state.svelte.ts │    │  Window, Globe, HUD,      │
 │  WindowModel + DI    │    │  SidePanel, CloudBlobs,   │
 └───┬─────────────┬────┘    │  Weather, MicroEvent      │
     │             │         └────────────┬──────────────┘
     v             v                      │
 ┌─────────┐  ┌──────────┐               │
 │ ENGINE  │  │ SERVICES │               │
 │ (pure)  │  │ (I/O)    │               │
 └────┬────┘  └────┬─────┘               │
      │            │                     │
      v            v                     v
 ┌───────────────────────────────────────────────────────┐
 │  SHARED (leaf — no internal imports)                  │
 │  types  constants  locations  protocol  utils         │
 └───────────────────────────────────────────────────────┘

 ┌───────────────────────────────────────────────────────┐
 │  SERVER (separate Bun process)                        │
 │  fleet-hub.ts — imports only shared/protocol + types  │
 └───────────────────────────────────────────────────────┘
```

## Data Flow: User Action

```
SidePanel slider → model.applyPatch({ cloudDensity: 0.8 })
     │
     v
WindowModel validates + clamps + sets $state
     │
     ├──→ $derived recalculates (skyState, nightFactor, effectiveCloudDensity...)
     │
     ├──→ Window.svelte reads derived → CSS (filterString, motionTransform)
     │
     └──→ CesiumManager reads model fields in postRender tick
          → syncCamera() → syncAtmosphere() → syncImagery() → syncBuildings()
```

## Data Flow: RAF Tick Loop

```
game-loop.ts (RAF singleton)
     │  subscribe(fn)
     v
Window.svelte $effect → model.tick(delta)
     │
     ├── flight.tick(delta, ctx) → orbit/scenario/cruise state machine
     │
     ├── motion.tick(delta, ctx) → turbulence/banking/breathing
     │
     └── world.tick(delta, worldCtx) → WorldPatch
         │  ├── atmosphere? → model.applyPatch(...)
         │  └── nextLocation? → flight.flyTo(...)
         │
         ├── #tickLightning → lightningIntensity
         ├── #tickRandomize → AtmospherePatch
         ├── #tickEvents → microEvent
         └── #tickDirector → LocationId (auto-pilot)
```

Note: CesiumManager has its own tick via Cesium's `postRender` event — decoupled from the game loop.

## Data Flow: Fleet Command

```
Admin dashboard → POST /api/fleet?action=scene
     │
     v
fleet-hub.ts → lookup display socket by deviceId
     │
     v
WebSocket → { type: 'set_scene', location: 'dubai', weather: 'clear' }
     │
     v
DisplayWsClient.#handleMessage → validates → model.flight.flyTo('dubai')
```

## Component Tree

```
+page.svelte ─── CONTEXT BOUNDARY (createAppState)
│
├── Window.svelte ─── useAppState(), game-loop subscription
│   ├── Globe.svelte ── useAppState(), CesiumManager lifecycle
│   ├── CloudBlobs.svelte ── props only
│   ├── Weather.svelte ── props only
│   └── MicroEvent.svelte ── props only
│
├── HUD.svelte ── useAppState()
│
└── SidePanel.svelte ── useAppState()
    ├── AirlineLoader.svelte (pure)
    ├── Toggle.svelte (props)
    └── RangeSlider.svelte (props)
```

## State Ownership

### WindowModel (coordinator)

| Field | Type | Range |
|-------|------|-------|
| location | `LocationId` | 18 cities |
| timeOfDay | `number` | 0-24 (UTC decimal) |
| weather | `WeatherType` | clear/cloudy/rain/overcast/storm |
| cloudDensity, cloudSpeed, haze | `number` | 0-1, 0-2, 0-0.2 |
| nightLightIntensity | `number` | 0-5 |
| blindOpen, showBuildings, showClouds | `boolean` | |
| displayMode | `DisplayMode` | flight/screensaver/video |
| qualityMode | `QualityMode` | performance/balanced/ultra |

**Derived:** currentLocation, localTimeOfDay, skyState, sceneFog, terrainExaggeration, nightFactor, dawnDuskFactor, effectiveCloudDensity

### FlightSimEngine

| Field | Notes |
|-------|-------|
| lat, lon, altitude, heading, pitch | Position (degrees/feet) |
| flightMode | orbit / cruise_departure / cruise_transit |
| warpFactor | 0-1 cruise transition intensity |
| orbitCenter/Radius/Bearing/Angle | Elliptical orbit params |

### MotionEngine

| Field | Notes |
|-------|-------|
| motionOffsetX/Y | Turbulence pixel displacement |
| bankAngle | Smoothed from heading delta |
| breathingOffset | Sinusoidal cabin sway |
| engineVibeX/Y | High-frequency vibration |

### WorldEngine

| Field | Notes |
|-------|-------|
| lightningIntensity, X, Y | Decaying flash |
| microEvent | shooting-star / bird / contrail |

## Key Interfaces

### SimulationContext (`engine/types.ts`)
Universal per-frame snapshot passed to all engine `tick()` methods. Pre-allocated object reused each frame (zero GC).

### ISimulationEngine<TContext, TPatch> (`engine/types.ts`)
Generic engine contract: `tick(delta, ctx) => TPatch`.

### WorldPatch (`world-engine.svelte.ts`)
Intention pattern — WorldEngine proposes, coordinator disposes:
```typescript
{ atmosphere?: AtmospherePatch; nextLocation?: LocationId | null }
```

### CesiumModelView (`cesium-manager.ts`)
Narrow read-only interface for CesiumManager. WindowModel satisfies structurally.

### FleetClientModel (`shared/protocol.ts`)
Narrow interface for DisplayWsClient. Decouples fleet service from concrete WindowModel.

### PatchableState (`app-state.svelte.ts`)
Fields that `model.applyPatch()` accepts — union of fleet-pushable and UI-adjustable state.

## Flight Mode State Machine

```
orbit ──flyTo()──→ cruise_departure ──(2s)──→ cruise_transit ──(2s)──→ orbit
                   warp ramp                   teleport + arrive
                   blind closes                blind opens
```

## CSS Layer System (z-order)

```
z:0   Cesium globe
z:1   CloudBlobs (SVG feTurbulence)
z:2   Weather (rain + lightning)
z:3   Micro-events
z:5   Frost
z:7   Wing silhouette
z:9   Glass vignette
z:10  Vignette
z:11  Glass recess rim
```
