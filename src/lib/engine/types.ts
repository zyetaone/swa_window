import type { WeatherType, LocationId, SkyState } from '$lib/shared/types';

/**
 * Universal context passed to all simulation engines each frame.
 * Standardizing this data prevents individual engines from needing
 * custom interfaces for common simulation parameters.
 */
export interface SimulationContext {
	/** Seconds since start of session (absolute game time) */
	time: number;
	/** Lat/Lon/Alt/Heading/Pitch of the aircraft */
	lat: number;
	lon: number;
	altitude: number;
	heading: number;
	pitch: number;
	/** Banking angle (degrees) */
	bankAngle: number;
	/** Environment state */
	weather: WeatherType;
	skyState: SkyState;
	/** Derived factors for smoothing/interpolation */
	nightFactor: number;
	dawnDuskFactor: number;
	/** Current loiter location */
	locationId: LocationId;
	/** User interaction flags (to pause auto-behavior) */
	userAdjustingAltitude: boolean;
	userAdjustingTime: boolean;
	userAdjustingAtmosphere: boolean;
	/** Atmosphere parameters */
	cloudDensity: number;
	cloudSpeed: number;
	haze: number;
	/** Turbulence level from weather effects */
	turbulenceLevel: 'light' | 'moderate' | 'severe';
}

/**
 * Base interface for all simulation engines.
 * TContext: The specific data needed by the engine (extends SimulationContext).
 * TPatch: Optional structural update returned to the orchestrator (WindowModel).
 */
export interface ISimulationEngine<TContext extends SimulationContext = SimulationContext, TPatch = void> {
	/**
	 * Compute state delta for the current frame.
	 * @param delta Time since last frame in seconds.
	 * @param ctx   Simulation context.
	 * @returns     Optional patch of state changes to be applied by the coordinator.
	 */
	tick(delta: number, ctx: TContext): TPatch;
}
