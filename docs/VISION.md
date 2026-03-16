# Aero Dynamic Window - True Vision

## What You See From Seat 12A at 35,000 Feet

### The View
Looking out the window on a real flight, you see:

1. **Sky (Above Horizon)**
   - Deep cobalt blue at zenith
   - Lighter blue/white toward horizon
   - Sun creates bloom effect
   - Stars visible at night (above cloud layer)

2. **Atmosphere (Horizon)**
   - Distinct haze layer
   - Atmospheric perspective (blue tint)
   - Curvature of Earth barely visible

3. **Clouds (Below/Around)**
   - Cumulus below - puffy white cotton balls
   - Cirrus at altitude - wispy streaks
   - Stratus layers - blankets
   - Volumetric - light scatters through them
   - Silver lining when sun behind

4. **Ground (35,000 feet = 10km down)**
   - Everything is TINY
   - Rivers appear as thin silver threads
   - Cities appear as gray patches with grid patterns
   - Mountains cast shadows, show snow caps
   - Deserts show tan/brown patterns
   - Oceans appear deep blue/black
   - Farmland shows patchwork patterns

5. **Wing (Seat Position Dependent)**
   - Rows 10-25: Wing fills lower 1/3 of view
   - Wing tip with winglet
   - Engine nacelle below wing
   - Wing flexes with turbulence (+/- 3 meters)
   - Leading edge, trailing edge, flaps

6. **Movement**
   - Slow drift across terrain
   - Banking during turns (up to 25°)
   - Subtle turbulence vibration
   - Heading changes visible as horizon tilts

## Seat Position Logic

```
SEAT | WING VISIBILITY | VIEW ANGLE
-----|-----------------|------------
1-10   None             Full horizon
11-15  Partial (inner)  Wing in bottom-left
16-20  Full wing        Wing fills bottom
21-25  Full + engine    Wing + engine visible
26-35  Trailing edge    Wing behind you
36+    None             Full horizon (rear)
```

## View Angle Logic

When looking:
- **Forward**: See more sky, wing trailing edge
- **Straight out**: Balanced sky/ground, full wing
- **Down**: Mostly ground, wing tip visible
- **Back**: Sky, wing leading edge (if over wing)

## Technical Implementation

### 1. Terrain (GLSL Shader)
- Use FBM noise for realistic terrain generation
- Biome types: Ocean, Desert, Forest, Mountains, Plains
- Rivers: Noise-based paths
- Cities: Instanced boxes with window patterns
- Scale: At 35,000ft, 100km visible radius

### 2. Clouds (Volumetric Shader)
- Layer 1: Low clouds (cumulus) at 2-3km
- Layer 2: Mid clouds (alto) at 5-7km
- Layer 3: High clouds (cirrus) at 10-12km
- Henyey-Greenstein phase function for scattering
- Beer's Law for density/absorption

### 3. Sky (Gradient Shader)
- Rayleigh scattering approximation
- Sun position based on time of day
- Star field at night (above clouds)

### 4. Wing (3D Model or Procedural)
- Swept wing profile (Airbus/Boeing style)
- Winglet at tip
- Engine nacelle (if seat position warrants)
- Attached to camera rig
- Flexes with turbulence

### 5. Flight Dynamics
- Position: lat/lon changing over time
- Altitude: 30,000-40,000 feet cruise
- Heading: Occasional turns (bank angle)
- Speed: Affects terrain scroll rate
- Turbulence: Random shake

### 6. Camera Rig
- Base position: Inside cabin, at window
- Parallax: Slight movement with mouse/touch
- Banking: Rotates with aircraft heading changes
- Turbulence: Subtle shake overlay

## Circadian Sync

Time of day affects:
- Sky colors (dawn orange, day blue, dusk purple, night dark)
- Sun/moon position
- Star visibility
- Cloud coloring
- City lights (on at night)
- Ground lighting (shadows)

## Views/Routes

Each "view" represents a flight route:
- **Dubai**: Desert terrain, modern city, clear skies
- **Himalayas**: Mountain terrain, snow peaks, thin clouds
- **Mumbai**: Coastal, tropical, monsoon clouds
- **Ocean**: Open water, scattered clouds, islands
- **Europe**: Patchwork farmland, rivers, old cities

## Event System

Special overlays:
- **Christmas**: Santa sleigh flying across
- **Diwali**: Fireworks from cities below
- **Birds**: Flock flying past window
- **Storm**: Lightning in distant clouds
- **Northern Lights**: Aurora when over polar routes
