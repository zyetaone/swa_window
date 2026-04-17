import { type LocationId, type WeatherType } from '$lib/types';
import { LOCATIONS } from '$lib/locations';
import type { PaletteName } from '../palettes';

/**
 * PlaygroundState — Centralized Svelte 5 reactive configuration.
 *
 * Additive glide-back: user adjustments act as temporary offsets on top of
 * the autopilot path. After a cooldown (user stops interacting), the value
 * smoothly lerps back toward the autopilot's target. Sliders bind directly
 * to the public getters/setters — the setter captures user intent by setting
 * a cooldown, and tick() handles the smooth return.
 */
export class PlaygroundState {
	// Location
	activeLocation = $state<LocationId>('dubai');

	// Environment
	timeOfDay = $state(22);
	weather = $state<WeatherType>('clear');
	maplibreSource = $state<string>('eox-s2');

	// Rendering flags
	mlTerrain = $state(true);
	mlBuildings = $state(true);
	mlAtmosphere = $state(true);
	showCityLights = $state(true);
	showLandmarks = $state(true);
	showThreeBillboards = $state(false);
	/** Cloud renderer: 'css3d' (volumetric PNG sprites) or 'css' (prod CloudBlobs fallback) */
	cloudRenderer = $state<'css3d' | 'css'>('css3d');

	// Cloud mechanics
	density = $state(0.75);
	cloudSpeed = $state(1.0);
	cloudScale = $state(1.0);
	cloudSpread = $state(1.0);

	// ── Glide-back flight mechanics ──────────────────────────────────────
	// Private backing fields + autopilot targets + cooldown timers.
	// Public get/set: slider binds work unchanged. Setter starts cooldown.
	// tick() lerps current → target after cooldown expires.

	#altitude = $state(30000);
	#altTarget = 30000;
	#altCooldown = 0;
	static readonly ALT_HOLD_SEC = 6;
	static readonly ALT_LERP_RATE = 0.4;  // exponential lerp/sec

	get altitude() { return this.#altitude; }
	set altitude(v: number) {
		this.#altitude = v;
		this.#altCooldown = PlaygroundState.ALT_HOLD_SEC;
	}

	#heading = $state(90);
	#headingTarget = 90;
	#headingCooldown = 0;
	static readonly HDG_HOLD_SEC = 4;
	static readonly HDG_LERP_RATE = 0.6;

	get heading() { return this.#heading; }
	set heading(v: number) {
		this.#heading = v;
		this.#headingCooldown = PlaygroundState.HDG_HOLD_SEC;
	}

	planeSpeed = $state(1.0);
	turbulenceLevel = $state<'light' | 'moderate' | 'severe'>('light');

	// Automations
	autoOrbit = $state(false);
	autoTime = $state(false);
	autoFly = $state(true);
	kioskMode = $state(true);

	// Orbital mechanics — elliptical holding pattern
	orbitAngle = $state(Math.random() * Math.PI * 2);
	orbitAngularSpeed = $state(0.07);
	orbitDirection = $state(Math.random() > 0.5 ? 1 : -1);   // CW or CCW
	orbitMajor = $state(0.08 + Math.random() * 0.04);         // major axis (deg)
	orbitMinor = $state(0.04 + Math.random() * 0.03);         // minor axis (deg)
	orbitTilt = $state(Math.random() * Math.PI);               // ellipse rotation
	nextLocationChange = $state(0);
	pitchBias = $state(0);

	// Cloud deck altitude — plane oscillates above/below this for the
	// "descend through clouds, climb back above" holding pattern feel.
	static readonly CLOUD_DECK_ALT = 28000;

	// Creative
	paletteName = $state<PaletteName>('auto');
	freeCam = $state(false);

	// Tunables
	lodMaxZoomLevels = $state(6);
	lodTileCountRatio = $state(2.0);

	constructor() {
		if (typeof window !== 'undefined') {
			this.nextLocationChange = performance.now() + 120_000 + Math.random() * 120_000;
			this.#heading = Math.floor(Math.random() * 360);
			this.#headingTarget = this.#heading;
		}
	}

	tick(dt: number, now: number, isBoosting = false) {
		if (this.autoTime) {
			this.timeOfDay = (this.timeOfDay + dt * 0.5) % 24;
		}

		if (this.autoFly || isBoosting) {
			// Kiosk auto-rotation
			if (this.kioskMode && now > this.nextLocationChange) {
				this.cycleLocation(now);
			}

			// Altitude: slow sine oscillation THROUGH the cloud deck.
			// At low point (~22k) you're below clouds looking up. At high (~38k) above.
			// Two-frequency sum avoids predictable rhythm.
			const altSlow = Math.sin(now * 0.00004) * 6000;     // ±6k, ~26min period
			const altFast = Math.sin(now * 0.00012) * 2000;     // ±2k, ~8.7min period
			this.#altTarget = Math.max(18_000, Math.min(42_000,
				PlaygroundState.CLOUD_DECK_ALT + altSlow + altFast
			));

			// Glide altitude toward target (skip during user cooldown)
			if (this.#altCooldown > 0) {
				this.#altCooldown -= dt;
			} else {
				this.#altitude += (this.#altTarget - this.#altitude) * (1 - Math.exp(-PlaygroundState.ALT_LERP_RATE * dt));
			}

			// Heading: autopilot target follows elliptical orbital angle
			this.orbitAngle += dt * this.orbitAngularSpeed * this.planeSpeed * this.orbitDirection;
			this.#headingTarget = ((this.orbitAngle * 180 / Math.PI) + 90) % 360;

			// Glide heading toward target
			if (this.#headingCooldown > 0) {
				this.#headingCooldown -= dt;
			} else {
				// Shortest-angle lerp (handles 359°→1° wrapping)
				let diff = this.#headingTarget - this.#heading;
				if (diff > 180) diff -= 360;
				if (diff < -180) diff += 360;
				this.#heading = (this.#heading + diff * (1 - Math.exp(-PlaygroundState.HDG_LERP_RATE * dt)) + 360) % 360;
			}
		} else if (this.autoOrbit) {
			this.#headingTarget = (this.#heading + dt * 5 * this.planeSpeed) % 360;
			if (this.#headingCooldown > 0) {
				this.#headingCooldown -= dt;
			} else {
				this.#heading = this.#headingTarget;
			}
		}
	}

	cycleLocation(now?: number) {
		const ids = LOCATIONS.map(l => l.id);
		const idx = ids.indexOf(this.activeLocation);
		this.activeLocation = ids[(idx + 1) % ids.length];

		// New segment profile — orbit shape varies per location, but direction
		// is locked at init (flight path pre-decided on start).
		this.#altTarget = 22_000 + Math.floor(Math.random() * 18_000);
		this.#altCooldown = 0;
		this.pitchBias = (Math.random() - 0.5) * 12;
		// orbitDirection stays fixed from init — no re-randomize per cycle
		this.orbitMajor = 0.06 + Math.random() * 0.06;
		this.orbitMinor = 0.03 + Math.random() * 0.04;
		this.orbitTilt = Math.random() * Math.PI;
		const turbs: ('light' | 'moderate' | 'severe')[] = ['light', 'light', 'light', 'moderate', 'moderate', 'severe'];
		this.turbulenceLevel = turbs[Math.floor(Math.random() * turbs.length)];

		if (now) {
			this.nextLocationChange = now + 120_000 + Math.random() * 120_000;
		}
	}

	reset() {
		this.#heading = 90;
		this.#headingTarget = 90;
		this.#headingCooldown = 0;
		this.#altitude = 30000;
		this.#altTarget = 30000;
		this.#altCooldown = 0;
		this.planeSpeed = 1.0;
		this.density = 0.6;
		this.cloudSpeed = 1.0;
		this.timeOfDay = 12;
		this.weather = 'clear';
		this.autoOrbit = false;
		this.autoTime = false;
		this.autoFly = true;
		this.kioskMode = true;
		this.turbulenceLevel = 'light';
		this.pitchBias = 0;
	}

	randomize() {
		this.#heading = Math.floor(Math.random() * 360);
		this.#headingTarget = this.#heading;
		this.#headingCooldown = 0;
		this.#altitude = Math.floor(15000 + Math.random() * 30000);
		this.#altTarget = this.#altitude;
		this.#altCooldown = 0;
		this.density = 0.3 + Math.random() * 0.6;
		this.cloudSpeed = 0.5 + Math.random() * 1.5;
		this.timeOfDay = Math.random() * 24;
		const turbs: ('light' | 'moderate' | 'severe')[] = ['light', 'moderate', 'severe'];
		this.turbulenceLevel = turbs[Math.floor(Math.random() * 3)];
		this.cycleLocation();
	}
}

// Module-level singleton — survives SvelteKit navigation. Acceptable for a
// scene lab route; if route-lifecycle cleanup is ever needed, migrate to
// createContext/getContext pattern.
export const pg = new PlaygroundState();
