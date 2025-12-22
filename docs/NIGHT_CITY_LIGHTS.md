# Night City Lights Implementation

This document describes the implementation of the night city lights system for the Aero Dynamic Window project.

## Overview

The night city lights system creates a realistic nighttime cityscape view by combining:
1. NASA Black Marble night imagery (satellite photos of Earth at night)
2. Emissive building colors in Cesium for glowing skyscrapers
3. Procedural point lights in Three.js for scattered city lights
4. Bloom post-processing for authentic light glow

## Architecture

### Hybrid Cesium + Three.js Approach

The system uses a layered approach:

```
┌─────────────────────────────────────────────────┐
│ Three.js Overlay (Scene3DOverlay.svelte)       │
│  ├── BloomEffect (post-processing glow)         │
│  ├── CityLights (800 procedural light sprites)  │
│  ├── VolumetricClouds                           │
│  ├── WeatherEffects                             │
│  └── EnhancedWing                               │
├─────────────────────────────────────────────────┤
│ Cesium Viewer (CesiumViewer.svelte)             │
│  ├── NASA Black Marble night imagery layer      │
│  ├── Cesium World Imagery day layer             │
│  ├── OSM 3D Buildings (with emissive styling)   │
│  └── Terrain                                    │
└─────────────────────────────────────────────────┘
```

## Components

### 1. CesiumViewer.svelte

**Location**: `/home/rdtect/Work/aero_dynamic_window/aero_dynamicWindow/src/lib/layers/CesiumViewer.svelte`

**Features**:
- **Dual Imagery Layers**: Switches between day satellite imagery and NASA Black Marble night lights
- **Dynamic Building Styling**: Changes OSM building colors from realistic materials (day) to warm emissive colors (night)
- **Smooth Transitions**: Fades between imagery layers during dawn/dusk

**Key Functions**:
- `syncImageryLayer()`: Switches between day/night imagery based on `skyState`
- `syncBuildingStyle()`: Updates building colors with warm emissive tones at night
- Night emissive colors: Warm amber (#ffd580), warm orange (#ff9966), soft warm white (#ffcc99)

**Configuration**:
```typescript
// Night colors - warm glow for lit buildings
const NIGHT_EMISSIVE_COLORS = {
  glass: '#ffd580',    // Warm amber for lit glass buildings
  brick: '#ff9966',    // Warm orange for lit brick
  concrete: '#ffcc99', // Soft warm white for concrete
  metal: '#ffffcc',    // Bright warm white for metal
  stone: '#ffb366',    // Warm amber for stone
  wood: '#ff8833',     // Warm orange for wood
  default: '#ffaa55'   // Warm yellow-orange default
};
```

### 2. CityLights.svelte

**Location**: `/home/rdtect/Work/aero_dynamic_window/aero_dynamicWindow/src/lib/layers/3d/CityLights.svelte`

**Features**:
- **Instanced Sprites**: 800 procedural light sprites for performance
- **Random Distribution**: Scattered across 40km horizontal × 500m vertical area
- **Warm Color Palette**: 5 realistic city light colors
- **Subtle Animation**: Random flicker effect (every 5-15 seconds per light)
- **Time-Based Visibility**: Only visible during night/dusk/dawn

**Configuration**:
```typescript
const NUM_LIGHTS = 800;
const SPREAD_HORIZONTAL = 40000; // 40km spread
const SPREAD_VERTICAL = 500;     // Building heights
const MIN_HEIGHT = 10;
const LIGHT_SIZE = 80;

// Warm city light colors
const LIGHT_COLORS = [
  new THREE.Color(1.0, 0.9, 0.7),  // Warm white
  new THREE.Color(1.0, 0.8, 0.5),  // Warm amber
  new THREE.Color(1.0, 0.85, 0.6), // Soft warm
  new THREE.Color(0.95, 0.95, 0.8),// Cool white (office)
  new THREE.Color(1.0, 0.7, 0.4),  // Orange street lights
];
```

**Rendering**:
- Uses `THREE.Sprite` with `THREE.SpriteMaterial`
- Additive blending for glow effect
- Random opacity (0.6-1.0) for depth variation
- Flicker animation via opacity modulation

### 3. BloomEffect.svelte

**Location**: `/home/rdtect/Work/aero_dynamic_window/aero_dynamicWindow/src/lib/layers/3d/BloomEffect.svelte`

**Features**:
- **UnrealBloomPass**: High-quality bloom post-processing from Three.js
- **Time-Adaptive**: Strength varies by `skyState`
- **Performance**: Only active during night/dusk/dawn
- **Proper Color Space**: Includes OutputPass for correct rendering

**Configuration**:
```typescript
// Bloom strength by time of day
skyState === "night" ? 1.2 // Strong bloom at night
skyState === "dusk"  ? 0.8 // Medium bloom at dusk
skyState === "dawn"  ? 0.4 // Subtle bloom at dawn
                     : 0.0 // No bloom during day

// Bloom settings
threshold: night ? 0.3 : 0.5 // Lower threshold = more bloom
radius: night ? 0.8 : 0.5
```

**Render Pipeline**:
1. `RenderPass`: Renders the scene
2. `UnrealBloomPass`: Applies bloom to bright pixels
3. `OutputPass`: Ensures proper color space

### 4. Scene3DOverlay.svelte

**Location**: `/home/rdtect/Work/aero_dynamic_window/aero_dynamicWindow/src/lib/layers/Scene3DOverlay.svelte`

**Integration**:
```svelte
<!-- City lights (night-time window lights) -->
<CityLights />

<!-- Bloom post-processing for night glow -->
<BloomEffect />
```

## Time-of-Day Behavior

### Night (skyState === 'night')
- NASA Black Marble imagery: 100% opacity
- Day imagery: 0% opacity
- Building colors: Full emissive warm glow
- City lights: Fully visible (opacity 1.0)
- Bloom: Strong (strength 1.2, threshold 0.3)

### Dusk (skyState === 'dusk')
- NASA Black Marble imagery: 100% opacity
- Day imagery: 0% opacity
- Building colors: Emissive warm glow
- City lights: 70% opacity
- Bloom: Medium (strength 0.8)

### Dawn (skyState === 'dawn')
- NASA Black Marble imagery: 40% opacity
- Day imagery: 60% opacity
- Building colors: Transitioning to day colors
- City lights: 30% opacity
- Bloom: Subtle (strength 0.4)

### Day (skyState === 'day')
- NASA Black Marble imagery: 0% opacity
- Day imagery: 100% opacity
- Building colors: Realistic material colors
- City lights: Hidden
- Bloom: Disabled

## Performance Considerations

1. **Instanced Rendering**: CityLights uses 800 sprites (not individual meshes)
2. **Conditional Rendering**: Components only render when `isNightTime === true`
3. **Debounced Updates**: Cesium syncs use debouncing to avoid unnecessary re-renders
4. **Additive Blending**: No depth writes for lights (performance + visual quality)
5. **Request Render Mode**: Cesium only renders when needed

## Configuration via ViewerState

All night city lights behavior is controlled via the central `ViewerState`:

```typescript
// From state.svelte.ts
skyState: 'night' | 'day' | 'dawn' | 'dusk'
timeOfDay: 0-24 (hours)
```

The `skyState` is automatically derived from `timeOfDay` via `EnvironmentSystem`.

## Visual Effect

The combination creates a realistic airplane window view at night:

1. **Satellite base**: NASA Black Marble shows real city light patterns from space
2. **3D buildings**: Warm emissive glow makes buildings look lit from within
3. **Scattered lights**: Procedural sprites add depth and detail (windows, streets)
4. **Bloom glow**: Post-processing gives lights authentic atmospheric scattering
5. **Subtle animation**: Flickering lights add life to the scene

## Testing

To test the night city lights system:

1. Run the dev server: `npm run dev`
2. Navigate to a city location (Dubai, Mumbai, Hyderabad, Dallas, etc.)
3. Set time to night: Use Tweakpane controls or set `timeOfDay = 22` (10 PM)
4. Adjust altitude: 25,000-40,000 feet for best view
5. Observe:
   - NASA Black Marble imagery showing city lights from space
   - Buildings glowing with warm emissive colors
   - Scattered point lights creating depth
   - Bloom glow around bright areas

## Future Enhancements

Possible improvements:
1. **Dynamic density**: More lights over cities, fewer over rural areas
2. **Building data**: Use OSM building data to place lights at actual building positions
3. **Traffic lights**: Animated moving lights for cars/planes
4. **Window patterns**: Grid patterns on buildings for realistic window lights
5. **Color temperature zones**: Different neighborhoods with different light colors
6. **Seasonal events**: Special lighting patterns for holidays

## Dependencies

- **Cesium Ion**: NASA Black Marble (Asset ID 3812) requires Cesium Ion token
- **Three.js**: `three/examples/jsm/postprocessing/*` for bloom
- **Threlte**: `@threlte/core` for Three.js integration in Svelte

## API Keys Required

```env
VITE_CESIUM_ION_TOKEN=your-cesium-ion-token-here
```

Get a free Cesium Ion token at: https://cesium.com/ion/tokens

The NASA Black Marble dataset is free to use with a Cesium Ion account.
