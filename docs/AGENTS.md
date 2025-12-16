# AGENTS.md - Coding Guidelines for Aero Dynamic Window

## 🛠️ Build & Development Commands

```bash
npm run dev          # Start development server (http://localhost:5173)
npm run build        # Production build
npm run preview      # Preview production build
npm run check        # Type checking with svelte-check
npm run check:watch  # Type checking in watch mode
```

## 🎨 Code Style Guidelines

### Svelte 5 Runes Pattern
```typescript
// Use $state for reactive variables
let count = $state(0);
let isVisible = $state(true);

// Use $derived for computed values
let doubled = $derived(count * 2);

// Use $effect for side effects
$effect(() => {
  console.log('Count changed:', count);
});
```

### Component Structure
```svelte
<script lang="ts">
  // Imports first
  import { T } from '@threlte/core';
  import type { ComponentProps } from './types';
  
  // Props interface
  interface Props {
    position: [number, number, number];
    color?: string;
  }
  
  // Destructure props with defaults
  let { position, color = '#ffffff' }: Props = $props();
  
  // Reactive state
  let isActive = $state(false);
  
  // Derived values
  let displayColor = $derived(isActive ? color : '#888888');
</script>

<!-- Component template -->
<T.Mesh position={position}>
  <T.BoxGeometry args={[1, 1, 1]} />
  <T.MeshStandardMaterial color={displayColor} />
</T.Mesh>

<style>
  /* Component-specific styles */
</style>
```

### Naming Conventions
- **Components**: PascalCase (e.g., `EnhancedCamera.svelte`)
- **Functions/Variables**: camelCase (e.g., `handleGesture`, `isVisible`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `CAMERA_SETTINGS`)
- **Types/Interfaces**: PascalCase (e.g., `FlightState`, `ViewType`)
- **File names**: kebab-case for components, camelCase for utilities

### Import Organization
```typescript
// 1. External libraries
import { T, useTask } from '@threlte/core';
import * as THREE from 'three';

// 2. Internal utilities/types
import { getWindowState } from '$lib/core/state.svelte';
import type { ViewType, SkyState } from '$lib/core/types';

// 3. Component-specific imports
import { getViewConfig } from '$lib/views';
```

### Error Handling
```typescript
// Use try-catch for async operations
try {
  const recognition = new SpeechRecognition();
  recognition.start();
} catch (error) {
  console.warn('Voice recognition not supported:', error);
}

// Validate inputs
function setAltitude(alt: number) {
  if (alt < 1000 || alt > 45000) {
    console.warn('Altitude out of range:', alt);
    return;
  }
  // Process valid altitude
}
```

### TypeScript Guidelines
- **Strict mode enabled** - All variables must be typed
- **Use type imports** for better tree-shaking
- **Prefer interfaces over types** for component props
- **Use const assertions** for literal types

### Three.js/Threlte Patterns
```typescript
// Create geometries/materials outside components when possible
const geometry = new THREE.PlaneGeometry(1, 1, 32, 32);
const material = new THREE.ShaderMaterial({ /* ... */ });

// Use Threlte's T component for declarative 3D
<T.Mesh geometry={geometry} material={material} />

// Update uniforms in $effect
$effect(() => {
  material.uniforms.time.value = windowState.shaderTime;
});
```

### Performance Guidelines
- **Use $derived** for expensive computations
- **Batch DOM updates** in $effect blocks
- **Split large libraries** (see vite.config.ts chunking)
- **Optimize Three.js** - reuse geometries/materials
- **Limit shader complexity** - especially in animation loops

### Testing Approach
```typescript
// Manual testing checklist:
// 1. Component renders without errors
// 2. Props work correctly with defaults
// 3. Reactive updates trigger properly
// 4. No TypeScript errors (npm run check)
// 5. Performance acceptable (60fps target)
```

## 🎯 Project-Specific Patterns

### State Management
- **Single source of truth**: `WindowState` class in `state.svelte.ts`
- **Context-based sharing**: Use `getWindowState()` in components
- **Derived values**: Use `$derived` for computed state

### 3D Scene Organization
```typescript
// Layer order in Scene3D.svelte:
// 1. Camera system
// 2. Atmospheric effects
// 3. Sky/background
// 4. Ground/terrain
// 5. Clouds
// 6. Wing/aircraft elements
```

### Coordinate System
- **X**: Right (starboard) from aircraft
- **Y**: Up from aircraft  
- **Z**: Forward (nose) from aircraft
- **Units**: Meters for 3D space, feet for altitude

## 🚨 Common Pitfalls to Avoid

1. **Don't use legacy reactive statements** (`$:`) - use `$derived` or `$effect`
2. **Don't create new Three.js objects in render loops** - reuse instances
3. **Don't forget TypeScript strict mode** - all variables need types
4. **Don't ignore the chunk size warning** - Three.js is large, optimize splitting
5. **Don't use relative imports** - use `$lib/` aliases

## 📁 File Structure
```
src/
├── lib/
│   ├── core/          # State management, types
│   ├── layers/        # UI components
│   │   └── 3d/        # 3D scene components
│   ├── views/         # Location configurations
│   └── shaders/       # GLSL shader code
└── routes/            # SvelteKit pages
```

---

*Last updated: December 2025*