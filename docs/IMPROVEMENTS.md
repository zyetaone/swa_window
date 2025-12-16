# Flight Simulator Realistic Window View Improvements

## Overview
Transformed the 3D flight simulator to provide a realistic side window view from seat 12A at 35,000 feet cruise altitude.

## Key Improvements

### 1. Camera Position & Perspective (Scene.svelte)
**Before**: Arbitrary camera position [15, 0, 5] with wide FOV
**After**: Realistic passenger seat position
- **Position**: [2, 1.5, 0] - Simulates passenger sitting ~3 feet from window at eye level
- **Rotation**: [-0.175, 1.57, 0] - Looking right with 10° downward tilt for natural ground viewing
- **FOV**: 70° - Matches human peripheral vision through airplane window
- **Near/Far**: 0.5 to 200,000 meters - Allows viewing from wing to horizon

### 2. Wing Placement (Wing.svelte)
**Before**: Wing at [-8, -30, -15] - arbitrary positioning
**After**: Realistic mid-cabin wing view
- **Position**: [25, -8, -5] - Wing visible to the right, below eye level, slightly forward
- **Rotation**: Subtle tilt to match real aircraft wing angle during cruise
- **Scale**: 2.5x - Appropriate size as seen from seat 12A
- **Details**: Engine nacelle visible under wing, winglet at tip

### 3. Altitude-Based Positioning (Scene.svelte)
**Before**: Ground and clouds floating at arbitrary heights
**After**: Realistic altitude separation
- **Ground**: Positioned 10,700 meters (35,000 feet) below camera
- **Cloud Layers**: Three realistic altitude bands:
  - Low clouds: -9,000m (cumulus at 6,500 ft)
  - Mid-level clouds: -6,000m (altocumulus at 20,000 ft)
  - High clouds: -2,000m (cirrus near cruise altitude)

### 4. Atmospheric Perspective (Terrain.svelte)
**Before**: Simple short-range fog
**After**: High-altitude atmospheric effects
- **Visibility**: 80-160km (50-100 miles) - realistic cruise altitude visibility
- **Fog Color**: Lighter bluish haze (0.65, 0.75, 0.88) - authentic atmospheric scattering
- **Terrain Colors**: More muted as seen from altitude
- **Lighting**: Softer, more diffuse lighting from high altitude
- **Three Parallax Layers**:
  - Foreground: 15-60km fog range
  - Midground: 30-100km fog range
  - Background/Horizon: 80-160km fog range

### 5. Scene-Level Fog (Scene.svelte)
**Added**: Three.js exponential fog
- **Color**: Light blue-gray (#a4bcd8)
- **Range**: 20-120km for depth perception
- **Effect**: Creates realistic haze and depth cueing

### 6. City Appearance (City.svelte)
**Before**: Bright, close-up city colors
**After**: High-altitude city appearance
- **Colors**: More muted (lower saturation and lightness)
- **Atmospheric Fog**: Enabled on material
- **Scale**: Buildings appear appropriately tiny from 35,000 feet

### 7. Cloud Improvements (Clouds.svelte)
**Before**: Single cloud layer at fixed height
**After**: Multiple cloud layers
- **Positioning**: Relative to camera altitude
- **Size**: Larger (80km x 80km) for realistic cloud field coverage
- **Transparency**: Proper alpha blending for volumetric appearance

## Technical Details

### Viewing Geometry
```
Passenger Eye Level: 1.5m above floor
Distance from Window: 2m
Wing Visibility: Lower right quadrant of view
Ground Distance: 10,700m directly below
Horizon Distance: ~100 miles (160km)
```

### Atmospheric Physics
- At 35,000 ft, atmospheric pressure is ~25% of sea level
- Rayleigh scattering creates blue haze
- Visibility can exceed 100 miles on clear days
- Clouds form in distinct altitude bands

### Performance Optimizations
- Maintained existing instanced mesh rendering for cities (8,000 buildings)
- Parallax terrain layers for depth without expensive geometry
- Shader-based fog (GPU-accelerated)
- Efficient cloud planes with procedural shaders

## Realism Features

✅ Correct passenger viewing angle from window seat
✅ Realistic wing position for mid-cabin window (row 12A)
✅ Accurate altitude separation (35,000 feet)
✅ Multi-layer cloud system at realistic altitudes
✅ Atmospheric haze and perspective
✅ Appropriate ground detail visibility
✅ Horizon at realistic distance
✅ Natural lighting from cruise altitude
✅ Subtle wing and aircraft motion
✅ Proper scale of ground features

## Result
The view now accurately simulates what a passenger sees from seat 12A during cruise flight:
- Wing visible in lower right
- Ground features tiny but visible below
- Atmospheric blue haze at distance
- Cloud layers at varying altitudes
- Natural lighting and perspective
- Realistic sense of speed and altitude
