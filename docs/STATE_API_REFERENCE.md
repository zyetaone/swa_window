# WindowModel API Reference

Quick reference for the consolidated state architecture using Svelte 5 runes.

## Import

```typescript
import { useAppState, createAppState, LOCATIONS, type LocationId } from '$lib/core';
```

## Root Component Setup

```typescript
// In +page.svelte
const appState = createAppState();
```

## Child Component Access

```typescript
// In any child component
const { model } = useAppState();
```

## WindowModel API

### Position & Camera

```typescript
model.lat: number           // Latitude
model.lon: number           // Longitude
model.utcOffset: number     // Hours from UTC for location timezone
model.altitude: number      // Altitude in feet (10k-50k)
model.heading: number       // Compass heading (0-360)
model.pitch: number         // Camera pitch angle
```

### Time

```typescript
model.timeOfDay: number        // Hour of day (0-24, decimal)
model.syncToRealTime: boolean  // Auto-sync with system time
model.localTimeOfDay: number   // (derived) Time at current location
```

### Location

```typescript
model.location: LocationId     // Current location preset
```

### Environment

```typescript
model.weather: WeatherType     // 'clear' | 'cloudy' | 'overcast' | 'storm'
model.cloudDensity: number     // 0-1
model.cloudSpeed: number       // 0.1-2.0 (drift speed multiplier)
model.cloudScale: number       // 0.5-3.0 (cloud size multiplier)
model.visibility: number       // km
model.haze: number             // 0-1
```

### Night Rendering

```typescript
model.nightLightIntensity: number  // 0.5-5 (city lights brightness)
model.terrainDarkness: number      // 0-1 (terrain darkening at night)
```

### Display Toggles

```typescript
model.blindOpen: boolean
model.showBuildings: boolean
model.showClouds: boolean
```

### Flight Speed

```typescript
model.flightSpeed: number  // 0.5-5 (drift rate multiplier)
```

### Motion State (updated by tick())

```typescript
model.motionOffsetX: number
model.motionOffsetY: number
model.motionOffsetZ: number
model.motionPitch: number
model.motionYaw: number
model.motionRoll: number
```

### Aircraft Systems

```typescript
model.strobeOn: boolean           // Strobe light state (auto-animated)
model.lightningIntensity: number  // 0-1 (storm lightning flashes)
```

### Transition State

```typescript
model.isTransitioning: boolean
model.transitionDestination: string | null
```

## Derived Properties

```typescript
model.localTimeOfDay: number       // Time adjusted for location UTC offset
model.skyState: SkyState           // 'day' | 'night' | 'dawn' | 'dusk'
model.sunPosition: SunPosition     // { x, y, z, azimuth, height }
model.biomeColors: BiomeColors     // Color palette for current location
model.altitudeMeters: number       // Altitude in meters
model.mapZoom: number              // Calculated zoom for Cesium

// Weather-derived
model.turbulenceLevel: 'light' | 'moderate' | 'severe'
model.cloudBase: number            // Cloud base altitude (weather-dependent)
model.showRain: boolean            // Rain visible below cloud base
model.showLightning: boolean       // Lightning enabled in storm
model.effectiveCloudDensity: number // Adjusted for weather
model.weatherAmbientReduction: number // Light reduction factor

// Lighting-derived
model.showNavLights: boolean
model.navLightIntensity: number
model.sunIntensity: number
model.ambientIntensity: number
```

## Methods

### Location

```typescript
model.setLocation(locationId: LocationId): void
```

### Camera/Time

```typescript
model.setTime(hours: number): void      // 0-24
model.setAltitude(feet: number): void   // 10000-50000
model.setWeather(weather: WeatherType): void
```

### Toggles

```typescript
model.toggleBlind(): void
model.toggleBuildings(): void
model.toggleClouds(): void
```

### Flight Transition

```typescript
model.flyTo(locationId: LocationId): Promise<void>
// Animated transition: blind close → ascend → cruise → descend → blind open
```

### Animation Tick

```typescript
model.tick(delta: number): void
// Called every frame - updates motion, strobe, lightning, drift
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

### WeatherType

```typescript
type WeatherType = 'clear' | 'cloudy' | 'overcast' | 'storm';
```

### Location

```typescript
interface Location {
  id: LocationId;
  name: string;
  lat: number;
  lon: number;
  utcOffset: number;      // Hours from UTC
  hasBuildings: boolean;
  defaultAltitude: number;
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

```typescript
import { LOCATIONS } from '$lib/core';

const dubai = LOCATIONS.find(l => l.id === 'dubai');
// { id: 'dubai', name: 'Dubai', lat: 25.2048, lon: 55.2708, utcOffset: 4, ... }
```

## Common Patterns

### Change Location

```typescript
model.setLocation('mumbai');
// or animated:
await model.flyTo('mumbai');
```

### Set Specific Time

```typescript
model.syncToRealTime = false;
model.setTime(18.5);  // 6:30 PM
```

### Change Weather

```typescript
model.weather = 'storm';
// Turbulence automatically syncs via derived state
```

### Access Motion for Camera

```svelte
<T.PerspectiveCamera
  position.y={1 + model.motionOffsetY}
/>
```

## Reactivity

All state uses Svelte 5 runes:

```svelte
{#if model.skyState === 'night'}
  <NightEffects />
{/if}

<p>Altitude: {model.altitude.toFixed(0)} ft</p>
<p>Local Time: {model.localTimeOfDay.toFixed(1)}</p>
```

## Storage

State is automatically persisted to localStorage:
- `location`, `altitude`, `weather`, `cloudDensity`
- `showBuildings`, `showClouds`, `syncToRealTime`

Key: `aero-window-v2`
