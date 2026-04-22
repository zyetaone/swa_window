/**
 * Sky phase system — single source of truth for the diurnal sky.
 *
 * Time of day (0–24) maps to ONE of six phases. Each phase has a config:
 *   - gradient: the CSS background for the scene-root "far sky"
 *   - moodColor: blur band tint
 *   - cloudTint: darker/warmer edge shadow for cloud sprites
 *   - showSun / showMoon: celestial visibility hints
 *   - starsOpacity: baseline star field intensity
 *   - sunColor, sunGlow, moonColor, moonGlow: palette for the discs
 *   - cityTint: ambient light cast from city glow onto nearby clouds (night only)
 *   - cityBloom: subtle radial bloom color around bright city clusters
 *
 * One config per phase → swappable per-phase snippets + CSS transitions.
 * Pure data + functions, no reactivity here (the consumer does that).
 *
 * Palette: SWA Variant B — calm-ambient, warm-amber nights, human warmth over drama.
 *   Heart Red   #E51D34  — accent only; thin dusk horizon band, never fill
 *   Summit Blue #304CB2  — dusk/night base gradient
 *   Canyon Yellow #F9B612 — sunrise/sunset warm highlights
 *   Desert Sand #E6DDB8  — dawn haze, morning diffusion
 *   Warm White  #FFFEF7  — noon clouds, specular highlights
 */

export type SkyPhase = 'night' | 'dawn' | 'morning' | 'noon' | 'evening' | 'dusk';

export const SKY_PHASES: SkyPhase[] = ['night', 'dawn', 'morning', 'noon', 'evening', 'dusk'];

export function getSkyPhase(timeOfDay: number): SkyPhase {
	const t = ((timeOfDay % 24) + 24) % 24;
	if (t < 5)  return 'night';
	if (t < 7)  return 'dawn';
	if (t < 11) return 'morning';
	if (t < 14) return 'noon';
	if (t < 17) return 'evening';
	if (t < 19) return 'dusk';
	return 'night';
}

export interface PhaseConfig {
	gradient: string;     // CSS linear-gradient for scene-root bg
	moodColor: string;    // mood tint for blur band
	cloudTint: string;    // cloud edge drop-shadow color
	showSun: boolean;
	showMoon: boolean;
	starsOpacity: number; // baseline (NightOverlay still ramps by nightFactor)
	sunColor: string;
	sunGlow: string;
	moonColor: string;
	moonGlow: string;
	// Bloom + filter tuning per phase (applied to celestial wrap/aura/sprite)
	bloomScale: number;       // 0.5 soft / 1.0 normal / 1.6 strong bloom spread
	bloomBlur: number;         // px of extra filter blur on the aura
	spriteBrightness: number;  // CSS filter brightness() on sun/moon sprite
	spriteSaturation: number;  // CSS filter saturate() on sun/moon sprite
	spriteHueShift: number;    // CSS filter hue-rotate(deg)
	// SWA Variant B additions
	cityTint: string;   // warm ambient cast from city lights onto low cloud undersides
	cityBloom: string;  // subtle golden halo around bright city clusters in the VIIRS layer
}

export const PHASE_CONFIGS: Record<SkyPhase, PhaseConfig> = {
	night: {
		// Near-black → muted Summit Blue — deep, quiet, not dramatic
		gradient: 'linear-gradient(180deg, #050A22 0%, #0C1240 45%, #162050 75%, #1E2A6B 100%)',
		moodColor: '#1E2A6B',
		cloudTint: 'rgba(20,30,80,0.45)',
		showSun: false,
		showMoon: true,
		starsOpacity: 1.0,
		// Moon: paper-warm white, not clinical blue-white
		sunColor: '#ffcc90',
		sunGlow: 'rgba(255,200,140,0.55)',
		moonColor: '#FFF4D6',
		moonGlow: 'rgba(255,244,214,0.40)',
		// Cool soft bloom for moon — small halo, slight warm cast vs original blue
		bloomScale: 1.3, bloomBlur: 0.9,
		spriteBrightness: 0.95, spriteSaturation: 0.85, spriteHueShift: 8,
		// City warmth: amber-tinted (warmer than raw Canyon Yellow)
		cityTint: 'rgba(255,184,74,0.55)',
		cityBloom: 'rgba(249,182,18,0.08)',
	},
	dawn: {
		// Soft lavender high → Canyon Yellow mid → Desert Sand horizon
		// Spec: #D8C4E0 → #F9B612; bottom anchored to Desert Sand for gentle fade
		gradient: 'linear-gradient(180deg, #2A1E50 0%, #D8C4E0 25%, #F9B612 55%, #E6DDB8 80%, #C8B898 100%)',
		moodColor: '#E8D4A8',
		cloudTint: 'rgba(160,110,60,0.40)',
		showSun: true,
		showMoon: true,
		starsOpacity: 0.20,
		// Sun low on horizon — Canyon Yellow, soft bloom
		sunColor: '#F9B612',
		sunGlow: 'rgba(249,182,18,0.60)',
		moonColor: '#FFF4D6',
		moonGlow: 'rgba(255,244,214,0.08)',
		// Wide warm bloom — golden hour feel, not blinding
		bloomScale: 1.9, bloomBlur: 1.6,
		spriteBrightness: 1.10, spriteSaturation: 1.20, spriteHueShift: 12,
		cityTint: 'rgba(255,184,74,0.30)',
		cityBloom: 'rgba(249,182,18,0.06)',
	},
	morning: {
		// Clear sky blue → Warm White — bright, clean, calm
		gradient: 'linear-gradient(180deg, #304CB2 0%, #6E9FD0 30%, #B9D4F2 60%, #FFFEF7 100%)',
		moodColor: '#D4E4F0',
		cloudTint: 'rgba(90,110,140,0.30)',
		showSun: true,
		showMoon: true,
		starsOpacity: 0,
		// Sun warming up — slightly warmer than noon but still controlled
		sunColor: '#FFE8B0',
		sunGlow: 'rgba(255,230,160,0.48)',
		moonColor: '#FFF4D6',
		moonGlow: 'rgba(255,244,214,0.06)',
		// Crisp bright sun, tight bloom
		bloomScale: 1.4, bloomBlur: 0.7,
		spriteBrightness: 1.20, spriteSaturation: 0.95, spriteHueShift: 0,
		cityTint: 'rgba(255,184,74,0.10)',
		cityBloom: 'rgba(249,182,18,0.04)',
	},
	noon: {
		// Same base hue as morning, brighter ambient — sky at peak
		gradient: 'linear-gradient(180deg, #304CB2 0%, #5B90D8 35%, #B9D4F2 65%, #FFFEF7 100%)',
		moodColor: '#C8D8EA',
		cloudTint: 'rgba(80,100,130,0.28)',
		showSun: true,
		showMoon: false,
		starsOpacity: 0,
		// Warm White specular — sun overhead, almost neutral
		sunColor: '#FFFEF7',
		sunGlow: 'rgba(255,254,247,0.50)',
		moonColor: '#FFF4D6',
		moonGlow: 'rgba(255,244,214,0.06)',
		// Brightest sun, minimal bloom — high-noon, not harsh
		bloomScale: 1.0, bloomBlur: 0.4,
		spriteBrightness: 1.32, spriteSaturation: 0.88, spriteHueShift: 0,
		cityTint: 'rgba(255,184,74,0.05)',
		cityBloom: 'rgba(249,182,18,0.03)',
	},
	evening: {
		// Canyon Yellow fading to Heart Red horizon — warm but not alarming
		// Note: Heart Red used only in bottom 15% of the gradient band
		gradient: 'linear-gradient(180deg, #2A3870 0%, #6878B0 25%, #F9B612 60%, #C84030 85%, #7A1A28 100%)',
		moodColor: '#D8A070',
		cloudTint: 'rgba(140,80,50,0.38)',
		showSun: true,
		showMoon: true,
		starsOpacity: 0.12,
		// Sun warm amber-orange at low angle
		sunColor: '#F9B612',
		sunGlow: 'rgba(249,182,18,0.58)',
		moonColor: '#FFF4D6',
		moonGlow: 'rgba(255,244,214,0.14)',
		// Warm wide bloom — golden hour, not opera
		bloomScale: 1.85, bloomBlur: 1.5,
		spriteBrightness: 1.08, spriteSaturation: 1.20, spriteHueShift: -8,
		cityTint: 'rgba(255,184,74,0.35)',
		cityBloom: 'rgba(249,182,18,0.07)',
	},
	dusk: {
		// Muted Summit Blue → Heart Red accent → near-black close
		// Heart Red (#E51D34) is the emotional peak — 10% band only, not fill
		gradient: 'linear-gradient(180deg, #1E2A6B 0%, #6A1C3F 40%, #E51D34 62%, #9A2020 78%, #1A1020 100%)',
		moodColor: '#A04060',
		cloudTint: 'rgba(120,40,50,0.42)',
		showSun: true,
		showMoon: true,
		starsOpacity: 0.38,
		// Sun at horizon — deep orange-red, Canyon into Heart
		sunColor: '#F9B612',
		sunGlow: 'rgba(229,29,52,0.45)',
		moonColor: '#FFF4D6',
		moonGlow: 'rgba(255,244,214,0.22)',
		// Deepest bloom — still controlled; original was 2.3/2.4 which pushed drama
		bloomScale: 2.1, bloomBlur: 2.0,
		spriteBrightness: 0.92, spriteSaturation: 1.30, spriteHueShift: -15,
		cityTint: 'rgba(255,184,74,0.50)',
		cityBloom: 'rgba(249,182,18,0.08)',
	},
};

/** Convenience — look up the config for the current timeOfDay. */
export function getPhaseConfig(timeOfDay: number): PhaseConfig {
	return PHASE_CONFIGS[getSkyPhase(timeOfDay)];
}
