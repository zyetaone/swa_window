/**
 * Flight Simulation
 *
 * Creates the illusion of flight through:
 * - Gradual position drift (simulates forward movement)
 * - Heading oscillation (gentle turns)
 * - Altitude variation (climbing/descending)
 * - Ground speed calculation
 */

import { getViewerState } from './state.svelte';
import { browser } from '$app/environment';

export interface FlightPath {
	id: string;
	name: string;
	waypoints: Array<{
		lat: number;
		lon: number;
		altitude: number;
		heading: number;
	}>;
	speed: number; // knots
	loop: boolean;
}

// Pre-defined flight paths
export const FLIGHT_PATHS: FlightPath[] = [
	{
		id: 'dubai-circle',
		name: 'Dubai City Circle',
		waypoints: [
			{ lat: 25.2048, lon: 55.2708, altitude: 8000, heading: 0 },
			{ lat: 25.2548, lon: 55.3208, altitude: 10000, heading: 45 },
			{ lat: 25.2548, lon: 55.3708, altitude: 12000, heading: 90 },
			{ lat: 25.2048, lon: 55.4208, altitude: 10000, heading: 135 },
			{ lat: 25.1548, lon: 55.3708, altitude: 8000, heading: 180 },
			{ lat: 25.1548, lon: 55.3208, altitude: 10000, heading: 225 },
			{ lat: 25.2048, lon: 55.2708, altitude: 8000, heading: 270 },
		],
		speed: 250,
		loop: true
	},
	{
		id: 'approach',
		name: 'Airport Approach',
		waypoints: [
			{ lat: 25.3, lon: 55.1, altitude: 15000, heading: 90 },
			{ lat: 25.27, lon: 55.2, altitude: 10000, heading: 95 },
			{ lat: 25.25, lon: 55.3, altitude: 5000, heading: 100 },
			{ lat: 25.24, lon: 55.35, altitude: 2000, heading: 100 },
		],
		speed: 180,
		loop: false
	}
];

export class FlightSimulation {
	private viewer = getViewerState();
	private running = false;
	private animationId: number | null = null;
	private lastTime = 0;

	// Current flight state
	private currentPath: FlightPath | null = null;
	private waypointIndex = 0;
	private progress = 0; // 0-1 between waypoints

	// Drift mode (gentle random movement)
	driftMode = $state(true);
	private driftTime = 0;
	private baseLat = 0;
	private baseLon = 0;
	private baseHeading = 0;

	// Speed (affects how fast things move)
	groundSpeed = $state(280); // knots

	// Base values for camera (user can override)
	basePitch = 75;

	constructor() {
		this.baseLat = this.viewer.lat;
		this.baseLon = this.viewer.lon;
		this.baseHeading = this.viewer.heading;

		// Auto-start in drift mode
		if (browser) {
			this.start();
		}
	}

	/**
	 * Start the flight simulation
	 */
	start(): void {
		if (this.running || !browser) return;

		this.running = true;
		this.lastTime = performance.now();
		this.baseLat = this.viewer.lat;
		this.baseLon = this.viewer.lon;
		this.baseHeading = this.viewer.heading;
		this.driftTime = 0;

		this.animate();
	}

	/**
	 * Stop the simulation
	 */
	stop(): void {
		this.running = false;
		if (this.animationId) {
			cancelAnimationFrame(this.animationId);
			this.animationId = null;
		}
	}

	/**
	 * Set base heading (called when user adjusts slider)
	 */
	setBaseHeading(heading: number): void {
		this.baseHeading = ((heading % 360) + 360) % 360;
		this.viewer.heading = this.baseHeading;
	}

	/**
	 * Set base pitch (called when user adjusts slider)
	 */
	setBasePitch(pitch: number): void {
		this.basePitch = Math.max(0, Math.min(90, pitch));
		this.viewer.pitch = this.basePitch;
	}

	/**
	 * Toggle simulation on/off
	 */
	toggle(): void {
		if (this.running) {
			this.stop();
		} else {
			this.start();
		}
	}

	/**
	 * Check if running
	 */
	get isRunning(): boolean {
		return this.running;
	}

	/**
	 * Start following a specific flight path
	 */
	followPath(pathId: string): void {
		const path = FLIGHT_PATHS.find(p => p.id === pathId);
		if (!path) return;

		this.currentPath = path;
		this.waypointIndex = 0;
		this.progress = 0;
		this.driftMode = false;
		this.groundSpeed = path.speed;

		// Jump to first waypoint
		const wp = path.waypoints[0];
		this.viewer.lat = wp.lat;
		this.viewer.lon = wp.lon;
		this.viewer.altitude = wp.altitude;
		this.viewer.heading = wp.heading;

		this.start();
	}

	/**
	 * Animation loop
	 */
	private animate = (): void => {
		if (!this.running) return;

		const now = performance.now();
		const deltaTime = (now - this.lastTime) / 1000; // seconds
		this.lastTime = now;

		if (this.driftMode) {
			this.updateDrift(deltaTime);
		} else if (this.currentPath) {
			this.updatePath(deltaTime);
		}

		this.animationId = requestAnimationFrame(this.animate);
	};

	/**
	 * Drift mode - dynamic organic movement simulating real flight
	 */
	private updateDrift(deltaTime: number): void {
		this.driftTime += deltaTime;

		// Convert ground speed to degrees/second
		// At equator: 1 degree ≈ 60 nautical miles
		// So speed in knots / 60 / 3600 = degrees/second
		const degreesPerSecond = this.groundSpeed / 60 / 3600;

		// Forward movement in heading direction
		const headingRad = this.viewer.heading * Math.PI / 180;
		const forwardLat = Math.cos(headingRad) * degreesPerSecond * deltaTime;
		const forwardLon = Math.sin(headingRad) * degreesPerSecond * deltaTime / Math.cos(this.viewer.lat * Math.PI / 180);

		this.viewer.lat += forwardLat;
		this.viewer.lon += forwardLon;

		// Dynamic heading changes - simulates gentle banking turns
		// Use multiple sine waves for organic feel
		const headingOscillation =
			Math.sin(this.driftTime * 0.08) * 2.5 +      // Slow wide turns
			Math.sin(this.driftTime * 0.17) * 1.5 +      // Medium corrections
			Math.sin(this.driftTime * 0.31) * 0.5;       // Quick adjustments

		this.viewer.heading = this.baseHeading + headingOscillation;
		if (this.viewer.heading < 0) this.viewer.heading += 360;
		if (this.viewer.heading >= 360) this.viewer.heading -= 360;

		// Altitude variation - simulates thermals, pressure changes, climb/descent
		const baseAltitude = 35000; // Target cruise altitude
		const altitudeVariation =
			Math.sin(this.driftTime * 0.03) * 2000 +     // Long climb/descent cycles
			Math.sin(this.driftTime * 0.11) * 500 +      // Medium variations
			Math.sin(this.driftTime * 0.29) * 100;       // Turbulence bumps

		// Keep within 10k-50k range
		this.viewer.altitude = Math.max(10000, Math.min(50000, baseAltitude + altitudeVariation));

		// Pitch variation - simulates nose attitude changes (subtle)
		const pitchVariation =
			Math.sin(this.driftTime * 0.05) * 2 +        // Slow pitch changes
			Math.sin(this.driftTime * 0.19) * 1;         // Medium adjustments

		this.viewer.pitch = Math.max(0, Math.min(90, this.basePitch + pitchVariation));

		// Gradual base heading change over time (aircraft slowly turns)
		this.baseHeading += deltaTime * 0.5; // ~0.5 degrees per second = full circle in 12 min
		if (this.baseHeading >= 360) this.baseHeading -= 360;
	}

	/**
	 * Path following mode
	 */
	private updatePath(deltaTime: number): void {
		if (!this.currentPath) return;

		const path = this.currentPath;
		const waypoints = path.waypoints;

		if (this.waypointIndex >= waypoints.length - 1) {
			if (path.loop) {
				this.waypointIndex = 0;
			} else {
				this.stop();
				return;
			}
		}

		const from = waypoints[this.waypointIndex];
		const to = waypoints[this.waypointIndex + 1];

		// Calculate distance between waypoints
		const dLat = to.lat - from.lat;
		const dLon = to.lon - from.lon;
		const distance = Math.sqrt(dLat * dLat + dLon * dLon) * 60; // nautical miles (rough)

		// Time to traverse this segment
		const segmentTime = distance / path.speed * 3600; // seconds

		// Update progress
		this.progress += deltaTime / segmentTime;

		if (this.progress >= 1) {
			this.progress = 0;
			this.waypointIndex++;
			return;
		}

		// Interpolate position
		const t = this.easeInOut(this.progress);
		this.viewer.lat = from.lat + (to.lat - from.lat) * t;
		this.viewer.lon = from.lon + (to.lon - from.lon) * t;
		this.viewer.altitude = from.altitude + (to.altitude - from.altitude) * t;

		// Interpolate heading (handle wrap-around)
		let dHeading = to.heading - from.heading;
		if (dHeading > 180) dHeading -= 360;
		if (dHeading < -180) dHeading += 360;
		this.viewer.heading = from.heading + dHeading * t;
		if (this.viewer.heading < 0) this.viewer.heading += 360;
		if (this.viewer.heading >= 360) this.viewer.heading -= 360;
	}

	/**
	 * Easing function for smooth movement
	 */
	private easeInOut(t: number): number {
		return t < 0.5
			? 2 * t * t
			: 1 - Math.pow(-2 * t + 2, 2) / 2;
	}
}

// Singleton
let instance: FlightSimulation | null = null;

export function getFlightSimulation(): FlightSimulation {
	if (!instance) {
		instance = new FlightSimulation();
	}
	return instance;
}
