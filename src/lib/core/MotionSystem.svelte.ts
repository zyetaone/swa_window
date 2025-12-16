/**
 * Motion System
 *
 * Simulates realistic flight motion:
 * - Engine vibration (constant high-frequency)
 * - Turbulence (variable intensity)
 * - Banking during turns
 * - Altitude changes (subtle pitch)
 */

import { getViewerState } from './state.svelte';

export type TurbulenceLevel = 'none' | 'light' | 'moderate' | 'severe';

export interface MotionState {
	// Camera offsets
	offsetX: number;
	offsetY: number;
	offsetZ: number;
	// Rotation offsets
	roll: number;
	pitch: number;
	yaw: number;
	// Vibration intensity
	vibration: number;
}

export class MotionSystem {
	// Motion state
	private _state = $state<MotionState>({
		offsetX: 0,
		offsetY: 0,
		offsetZ: 0,
		roll: 0,
		pitch: 0,
		yaw: 0,
		vibration: 0
	});

	// Configuration
	turbulenceLevel = $state<TurbulenceLevel>('light');
	engineVibration = $state(true);
	enabled = $state(true);

	// Internal timing
	private time = 0;
	private lastHeading = 0;

	// Turbulence intensity mapping
	private readonly turbulenceIntensity: Record<TurbulenceLevel, number> = {
		none: 0,
		light: 0.3,
		moderate: 0.7,
		severe: 1.0
	};

	// Get current motion state
	get state(): MotionState {
		return this._state;
	}

	// Update motion (call each frame)
	update(deltaTime: number): void {
		if (!this.enabled) {
			this.resetState();
			return;
		}

		this.time += deltaTime;
		const viewer = getViewerState();

		// === ENGINE VIBRATION ===
		// High frequency, low amplitude constant shake
		let vibrationX = 0;
		let vibrationY = 0;
		let vibrationZ = 0;

		if (this.engineVibration) {
			const vibFreq = 60; // Hz
			const vibAmp = 0.0005;
			vibrationX = Math.sin(this.time * vibFreq) * vibAmp;
			vibrationY = Math.sin(this.time * vibFreq * 1.1 + 1) * vibAmp;
			vibrationZ = Math.sin(this.time * vibFreq * 0.9 + 2) * vibAmp * 0.5;
		}

		// === TURBULENCE ===
		const turbIntensity = this.turbulenceIntensity[this.turbulenceLevel];
		let turbX = 0;
		let turbY = 0;
		let turbZ = 0;
		let turbRoll = 0;
		let turbPitch = 0;

		if (turbIntensity > 0) {
			// Multiple overlapping sine waves for organic feel
			const t = this.time;

			// Position turbulence
			turbX =
				(Math.sin(t * 0.5) * 0.3 +
					Math.sin(t * 1.3 + 1) * 0.2 +
					Math.sin(t * 2.7 + 2) * 0.1) *
				turbIntensity *
				0.01;

			turbY =
				(Math.sin(t * 0.7 + 3) * 0.4 +
					Math.sin(t * 1.9 + 4) * 0.3 +
					Math.sin(t * 3.1 + 5) * 0.1) *
				turbIntensity *
				0.015;

			turbZ =
				(Math.sin(t * 0.4 + 6) * 0.2 + Math.sin(t * 1.1 + 7) * 0.15) *
				turbIntensity *
				0.008;

			// Rotation turbulence
			turbRoll =
				(Math.sin(t * 0.3 + 8) * 0.5 + Math.sin(t * 0.8 + 9) * 0.3) *
				turbIntensity *
				0.02;

			turbPitch =
				(Math.sin(t * 0.25 + 10) * 0.3 + Math.sin(t * 0.6 + 11) * 0.2) *
				turbIntensity *
				0.01;

			// Random bumps (occasional larger movements)
			if (Math.random() < turbIntensity * 0.01) {
				turbY += (Math.random() - 0.5) * turbIntensity * 0.05;
			}
		}

		// === BANKING (during heading changes) ===
		const headingDelta = viewer.heading - this.lastHeading;
		const normalizedDelta =
			((headingDelta + 180) % 360) - 180; // Handle wrap-around
		const bankAngle = normalizedDelta * 0.01; // Convert to roll
		this.lastHeading = viewer.heading;

		// === ALTITUDE CHANGES ===
		// (Would need altitude history for proper implementation)
		// For now, just subtle pitch based on current altitude tier

		// === COMBINE ALL MOTION ===
		this._state = {
			offsetX: vibrationX + turbX,
			offsetY: vibrationY + turbY,
			offsetZ: vibrationZ + turbZ,
			roll: turbRoll + bankAngle,
			pitch: turbPitch,
			yaw: 0,
			vibration: turbIntensity + (this.engineVibration ? 0.1 : 0)
		};
	}

	// Reset to zero state
	private resetState(): void {
		this._state = {
			offsetX: 0,
			offsetY: 0,
			offsetZ: 0,
			roll: 0,
			pitch: 0,
			yaw: 0,
			vibration: 0
		};
	}

	// Set turbulence from weather conditions
	setTurbulenceFromWeather(weather: string): void {
		const weatherTurbulence: Record<string, TurbulenceLevel> = {
			clear: 'light',
			cloudy: 'light',
			overcast: 'moderate',
			storm: 'severe'
		};
		this.turbulenceLevel = weatherTurbulence[weather] ?? 'light';
	}
}

// Singleton
let instance: MotionSystem | null = null;

export function getMotionSystem(): MotionSystem {
	if (!instance) {
		instance = new MotionSystem();
	}
	return instance;
}
