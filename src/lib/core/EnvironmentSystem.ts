/**
 * Biome Colors - Color palettes for different locations and sky states
 */
import { type SkyState } from './types';

export interface BiomeColors {
    ground: string;
    horizon: string;
    accent: string;
    secondary: string;
}

const BIOME_PALETTES: Partial<Record<string, Record<SkyState, BiomeColors>>> & Record<'dubai', Record<SkyState, BiomeColors>> = {
    dubai: {
        day: { ground: '#d4a574', horizon: '#87ceeb', accent: '#c49464', secondary: '#e4c594' },
        night: { ground: '#3a2a1a', horizon: '#0a0a1a', accent: '#2a1a0a', secondary: '#4a3a2a' },
        dawn: { ground: '#e4b584', horizon: '#ff8a5a', accent: '#d4a574', secondary: '#f4c594' },
        dusk: { ground: '#c49464', horizon: '#fa6a3a', accent: '#b48454', secondary: '#d4a474' }
    },
    himalayas: {
        day: { ground: '#6b5335', horizon: '#87ceeb', accent: '#8b7355', secondary: '#5b4325' },
        night: { ground: '#2b2315', horizon: '#0a0a1a', accent: '#1b1305', secondary: '#3b3325' },
        dawn: { ground: '#7b6345', horizon: '#ff8a5a', accent: '#9b8365', secondary: '#6b5335' },
        dusk: { ground: '#5b4325', horizon: '#fa6a3a', accent: '#7b6345', secondary: '#4b3315' }
    },
    mumbai: {
        day: { ground: '#5d4d3d', horizon: '#87ceeb', accent: '#7d6d5d', secondary: '#4d3d2d' },
        night: { ground: '#2d1d0d', horizon: '#0a0a1a', accent: '#1d0d00', secondary: '#3d2d1d' },
        dawn: { ground: '#6d5d4d', horizon: '#ff8a5a', accent: '#8d7d6d', secondary: '#5d4d3d' },
        dusk: { ground: '#4d3d2d', horizon: '#fa6a3a', accent: '#6d5d4d', secondary: '#3d2d1d' }
    },
    ocean: {
        day: { ground: '#0a4080', horizon: '#87ceeb', accent: '#1e90ff', secondary: '#0a3060' },
        night: { ground: '#051530', horizon: '#0a0a1a', accent: '#082040', secondary: '#030a20' },
        dawn: { ground: '#1a5090', horizon: '#ff8a5a', accent: '#3a90d0', secondary: '#0a4070' },
        dusk: { ground: '#0a3060', horizon: '#fa6a3a', accent: '#2a70b0', secondary: '#052050' }
    },
    clouds: {
        day: { ground: '#e8e8f0', horizon: '#87ceeb', accent: '#ffffff', secondary: '#d0d0e0' },
        night: { ground: '#606070', horizon: '#0a0a1a', accent: '#808090', secondary: '#505060' },
        dawn: { ground: '#ffd0a0', horizon: '#ff8a5a', accent: '#ffe0b0', secondary: '#eec090' },
        dusk: { ground: '#e0b080', horizon: '#fa6a3a', accent: '#f0c090', secondary: '#d0a070' }
    }
};

// Desert uses same palette as Dubai
(BIOME_PALETTES as Record<string, Record<SkyState, BiomeColors>>).desert = BIOME_PALETTES.dubai;

/**
 * Get biome colors for a location and sky state
 * Used by ViewerState for reactive color derivation
 */
export function getBiomeColors(location: string, skyState: SkyState): BiomeColors {
    const viewPalette = BIOME_PALETTES[location] ?? BIOME_PALETTES.dubai;
    return viewPalette[skyState] ?? viewPalette.day;
}
