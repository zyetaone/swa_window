# State Management API Reference

Quick reference for the consolidated state architecture.

## Import

```typescript
import { useAppState, createAppState, LOCATIONS, FLIGHT_PATHS } from '$lib/core';
```

## Root Component Setup

```typescript
// In +page.svelte or root layout
const appState = createAppState();
const { viewer, flight } = appState;

// Optional: Sync turbulence with weather
$effect(() => {
    flight.setTurbulenceFromWeather(viewer.weather);
});
```

## Child Component Access

```typescript
// In any child component
const { viewer, flight } = useAppState();
```

## ViewerState API

### Properties (reactive with $state)

```typescript
// Position & Camera
viewer.lat: number           // Latitude (-90 to 90)
viewer.lon: number           // Longitude (-180 to 180)
viewer.altitude: number      // Altitude in feet (10k-50k)
viewer.heading: number       // Compass heading (0-360)
viewer.pitch: number         // Camera pitch angle (0-90)

// Time
viewer.timeOfDay: number     // Hour of day (0-24, decimal)
viewer.syncToRealTime: boolean  // Auto-sync with system time

// Location
viewer.location: LocationId  // Current location preset

// Toggles
viewer.showBuildings: boolean
viewer.showClouds: boolean
viewer.blindOpen: boolean

// Weather & Atmosphere
viewer.cloudDensity: number  // 0-1
viewer.visibility: number    // km
viewer.haze: number         // 0-1
viewer.weather: 'clear' | 'cloudy' | 'overcast' | 'storm'

// Night rendering
viewer.nightLightIntensity: number  // 0.5-5
viewer.terrainDarkness: number      // 0-1

// Transition state
viewer.isTransitioning: boolean
viewer.transitionDestination: string | null
```

### Derived Properties (reactive with $derived)

```typescript
viewer.skyState: SkyState          // 'day' | 'night' | 'dawn' | 'dusk'
viewer.sunPosition: SunPosition    // { x, y, z, azimuth, height }
viewer.biomeColors: BiomeColors    // Color palette for current view
viewer.mapZoom: number            // Calculated zoom based on altitude
```

### Methods

```typescript
// Location
viewer.setLocation(locationId: LocationId): void

// Camera
viewer.setTime(hours: number): void         // 0-24
viewer.setAltitude(feet: number): void      // 500-45000
viewer.setHeading(degrees: number): void    // 0-360

// Toggles
viewer.toggleBlind(): void
viewer.toggleBuildings(): void
viewer.toggleClouds(): void
```

## FlightDynamics API

### Properties

```typescript
// Simulation control
flight.isRunning: boolean           // Read-only
flight.driftMode: boolean          // Drift vs waypoint mode
flight.groundSpeed: number         // Knots

// Motion effects
flight.turbulenceLevel: TurbulenceLevel  // 'none' | 'light' | 'moderate' | 'severe'
flight.engineVibration: boolean
flight.motionEnabled: boolean

// Motion state (read-only)
flight.motionState: MotionState    // Camera offsets and rotations
```

### Motion State Structure

```typescript
interface MotionState {
    // Camera position offsets
    offsetX: number;
    offsetY: number;
    offsetZ: number;

    // Camera rotation offsets
    roll: number;
    pitch: number;
    yaw: number;
}
```

### Methods

```typescript
// Simulation control
flight.start(): void
flight.stop(): void
flight.toggle(): void

// Manual control
flight.setBaseHeading(degrees: number): void
flight.setBasePitch(degrees: number): void

// Path following
flight.followPath(pathId: string): void

// Weather sync
flight.setTurbulenceFromWeather(weather: string): void

// Internal (called by createAppState)
flight.connectViewer(callback: UpdateCallback): void
flight.initialize(state: InitialState): void
```

## Types

### LocationId

```typescript
type LocationId =
    | 'dubai'
    | 'himalayas'
    | 'mumbai'
    | 'ocean'
    | 'desert'
    | 'clouds'
    | 'hyderabad'
    | 'dallas'
    | 'phoenix'
    | 'las_vegas';
```

### LocationPreset

```typescript
interface LocationPreset {
    id: LocationId;
    name: string;
    lat: number;
    lon: number;
    hasBuildings: boolean;
    defaultAltitude: number;  // feet
}
```

### FlightPath

```typescript
interface FlightPath {
    id: string;
    name: string;
    waypoints: Array<{
        lat: number;
        lon: number;
        altitude: number;
        heading: number;
    }>;
    speed: number;  // knots
    loop: boolean;
}
```

### SkyState

```typescript
type SkyState = 'day' | 'night' | 'dawn' | 'dusk';
```

### SunPosition

```typescript
interface SunPosition {
    x: number;
    y: number;
    z: number;
    azimuth: number;   // degrees
    height: number;    // 0-1
}
```

### BiomeColors

```typescript
interface BiomeColors {
    ground: string;     // hex color
    horizon: string;    // hex color
    accent: string;     // hex color
    secondary: string;  // hex color
}
```

## Constants

### LOCATIONS

Array of all location presets:

```typescript
const dubai = LOCATIONS.find(l => l.id === 'dubai');
// { id: 'dubai', name: 'Dubai', lat: 25.2048, lon: 55.2708, ... }
```

### FLIGHT_PATHS

Array of predefined flight paths:

```typescript
const path = FLIGHT_PATHS.find(p => p.id === 'dubai-circle');
flight.followPath(path.id);
```

Available paths:
- `'dubai-circle'` - Circular pattern over Dubai
- `'approach'` - Airport approach simulation

## Common Patterns

### Change Location

```typescript
viewer.setLocation('mumbai');
```

### Set Specific Time

```typescript
viewer.syncToRealTime = false;
viewer.setTime(18.5);  // 6:30 PM
```

### Change Weather and Turbulence

```typescript
viewer.weather = 'storm';
// Turbulence syncs automatically if you set up the $effect in root
```

### Access Motion for Camera

```typescript
<T.PerspectiveCamera
    position={[
        baseX + flight.motionState.offsetX,
        baseY + flight.motionState.offsetY,
        baseZ + flight.motionState.offsetZ
    ]}
    rotation={[
        flight.motionState.pitch,
        flight.motionState.yaw,
        flight.motionState.roll
    ]}
/>
```

### Follow Flight Path

```typescript
flight.followPath('dubai-circle');
// Simulation automatically switches to waypoint mode
```

### Manual Flight Control

```typescript
flight.driftMode = true;
flight.groundSpeed = 350;  // Faster
flight.setBaseHeading(90); // East
```

## Reactivity

All state properties are reactive using Svelte 5 runes:

```svelte
{#if viewer.skyState === 'night'}
    <NightSky />
{:else}
    <DaySky />
{/if}

<p>Altitude: {viewer.altitude.toFixed(0)} ft</p>
<p>Time: {viewer.timeOfDay.toFixed(1)}</p>
```

Derived values update automatically:

```svelte
<div style="background: {viewer.biomeColors.horizon}">
    Sky State: {viewer.skyState}
</div>
```

## Error Handling

The API fails fast with helpful errors:

```typescript
// ❌ Calling useAppState outside component tree
const { viewer } = useAppState();
// Error: Cannot get context outside component tree

// ✅ Correct usage
<script>
    const { viewer } = useAppState();
</script>
```

## Performance Notes

- FlightDynamics runs a single `requestAnimationFrame` loop
- Updates are batched (position + motion in one frame)
- Motion state is recalculated every frame (~60 FPS)
- ViewerState uses Svelte's fine-grained reactivity
- Derived values are only recomputed when dependencies change

## Debugging

Access state in dev tools:

```typescript
// In root component
const appState = createAppState();
if (import.meta.env.DEV) {
    (window as any).__APP_STATE__ = appState;
}
```

Then in console:

```javascript
__APP_STATE__.viewer.setLocation('himalayas')
__APP_STATE__.flight.turbulenceLevel = 'severe'
```
