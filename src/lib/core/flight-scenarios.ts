/**
 * Flight Scenarios — Waypoint-based flight paths that tell a story
 *
 * Each location gets 2-3 scenarios (approach, cruise, scenic).
 * Waypoints are geographically accurate with real lat/lon near airports/landmarks.
 * The Director picks time-appropriate scenarios for dramatic lighting.
 *
 * Waypoint durations total 3-5 minutes per loop so terrain keeps changing.
 */

import type { LocationId, SkyState } from '$lib/shared/types';

// ============================================================================
// TYPES
// ============================================================================

export interface Waypoint {
	lat: number;
	lon: number;
	altitude: number;    // feet
	heading: number;     // degrees (0=N, 90=E, 180=S, 270=W)
	duration: number;    // seconds to reach this waypoint from previous
}

export interface FlightScenario {
	id: string;
	locationId: LocationId;
	name: string;
	waypoints: Waypoint[];
	loop: boolean;
	preferredTime: 'any' | 'day' | 'night' | 'dawn' | 'dusk';
}

// ============================================================================
// SCENARIO DATA
// ============================================================================

const SCENARIOS: FlightScenario[] = [

	// ---- DUBAI ----

	{
		id: 'dubai-approach',
		locationId: 'dubai',
		name: 'Dubai Approach via Palm Jumeirah',
		loop: true,
		preferredTime: 'dusk',
		waypoints: [
			{ lat: 25.35,  lon: 55.10,  altitude: 28000, heading: 135, duration: 0 },
			{ lat: 25.30,  lon: 55.15,  altitude: 22000, heading: 140, duration: 30 },
			{ lat: 25.25,  lon: 55.20,  altitude: 16000, heading: 150, duration: 25 },
			{ lat: 25.20,  lon: 55.14,  altitude: 10000, heading: 180, duration: 25 },   // Over Palm Jumeirah
			{ lat: 25.15,  lon: 55.17,  altitude: 8000,  heading: 160, duration: 20 },
			{ lat: 25.10,  lon: 55.22,  altitude: 6000,  heading: 120, duration: 20 },   // Near DXB runway
			{ lat: 25.12,  lon: 55.30,  altitude: 8000,  heading: 45,  duration: 20 },   // Go-around climb
			{ lat: 25.18,  lon: 55.35,  altitude: 14000, heading: 10,  duration: 25 },
			{ lat: 25.28,  lon: 55.30,  altitude: 22000, heading: 330, duration: 30 },
			{ lat: 25.35,  lon: 55.20,  altitude: 28000, heading: 270, duration: 30 },
		],
	},
	{
		id: 'dubai-cruise',
		locationId: 'dubai',
		name: 'Dubai Coastal Cruise',
		loop: true,
		preferredTime: 'day',
		waypoints: [
			{ lat: 25.30,  lon: 55.20,  altitude: 30000, heading: 45,  duration: 0 },
			{ lat: 25.35,  lon: 55.30,  altitude: 30000, heading: 60,  duration: 35 },
			{ lat: 25.32,  lon: 55.42,  altitude: 29000, heading: 120, duration: 30 },   // Over Sharjah
			{ lat: 25.22,  lon: 55.48,  altitude: 28000, heading: 200, duration: 30 },
			{ lat: 25.12,  lon: 55.40,  altitude: 28000, heading: 240, duration: 30 },
			{ lat: 25.08,  lon: 55.25,  altitude: 29000, heading: 290, duration: 30 },   // South of Dubai
			{ lat: 25.15,  lon: 55.10,  altitude: 30000, heading: 340, duration: 30 },
			{ lat: 25.25,  lon: 55.12,  altitude: 30000, heading: 20,  duration: 30 },
		],
	},
	{
		id: 'dubai-night',
		locationId: 'dubai',
		name: 'Dubai Night City Lights',
		loop: true,
		preferredTime: 'night',
		waypoints: [
			{ lat: 25.22,  lon: 55.28,  altitude: 18000, heading: 180, duration: 0 },
			{ lat: 25.16,  lon: 55.26,  altitude: 16000, heading: 200, duration: 25 },   // Downtown/Burj Khalifa
			{ lat: 25.10,  lon: 55.18,  altitude: 15000, heading: 250, duration: 25 },
			{ lat: 25.08,  lon: 55.10,  altitude: 14000, heading: 300, duration: 25 },   // Marina
			{ lat: 25.12,  lon: 55.05,  altitude: 15000, heading: 350, duration: 25 },
			{ lat: 25.20,  lon: 55.08,  altitude: 16000, heading: 30,  duration: 25 },
			{ lat: 25.28,  lon: 55.15,  altitude: 17000, heading: 80,  duration: 25 },
			{ lat: 25.30,  lon: 55.28,  altitude: 18000, heading: 150, duration: 25 },
		],
	},

	// ---- MUMBAI ----

	{
		id: 'mumbai-coastal',
		locationId: 'mumbai',
		name: 'Mumbai Coastal Approach',
		loop: true,
		preferredTime: 'dawn',
		waypoints: [
			{ lat: 19.20,  lon: 72.70,  altitude: 30000, heading: 150, duration: 0 },
			{ lat: 19.15,  lon: 72.78,  altitude: 24000, heading: 140, duration: 30 },
			{ lat: 19.10,  lon: 72.85,  altitude: 18000, heading: 130, duration: 30 },   // Marine Drive approach
			{ lat: 19.05,  lon: 72.88,  altitude: 14000, heading: 170, duration: 25 },   // Over Worli Sea Link
			{ lat: 18.98,  lon: 72.84,  altitude: 11000, heading: 210, duration: 25 },
			{ lat: 18.95,  lon: 72.78,  altitude: 10000, heading: 270, duration: 20 },   // Near CSIA
			{ lat: 18.98,  lon: 72.72,  altitude: 14000, heading: 330, duration: 25 },   // Climb out
			{ lat: 19.08,  lon: 72.68,  altitude: 22000, heading: 350, duration: 30 },
			{ lat: 19.18,  lon: 72.68,  altitude: 28000, heading: 20,  duration: 30 },
		],
	},
	{
		id: 'mumbai-cruise',
		locationId: 'mumbai',
		name: 'Mumbai Harbor Cruise',
		loop: true,
		preferredTime: 'any',
		waypoints: [
			{ lat: 19.12,  lon: 72.82,  altitude: 28000, heading: 60,  duration: 0 },
			{ lat: 19.15,  lon: 72.92,  altitude: 28000, heading: 80,  duration: 30 },
			{ lat: 19.10,  lon: 73.02,  altitude: 27000, heading: 150, duration: 30 },
			{ lat: 19.02,  lon: 73.00,  altitude: 27000, heading: 220, duration: 30 },
			{ lat: 18.95,  lon: 72.90,  altitude: 28000, heading: 260, duration: 30 },
			{ lat: 18.98,  lon: 72.78,  altitude: 28000, heading: 320, duration: 30 },
			{ lat: 19.06,  lon: 72.76,  altitude: 28000, heading: 10,  duration: 30 },
		],
	},

	// ---- HYDERABAD ----

	{
		id: 'hyderabad-approach',
		locationId: 'hyderabad',
		name: 'Hyderabad RGIA Approach',
		loop: true,
		preferredTime: 'dusk',
		waypoints: [
			{ lat: 17.60,  lon: 78.20,  altitude: 28000, heading: 160, duration: 0 },
			{ lat: 17.55,  lon: 78.28,  altitude: 22000, heading: 150, duration: 30 },
			{ lat: 17.48,  lon: 78.35,  altitude: 16000, heading: 140, duration: 25 },   // Over old city
			{ lat: 17.40,  lon: 78.42,  altitude: 12000, heading: 150, duration: 25 },
			{ lat: 17.35,  lon: 78.45,  altitude: 8000,  heading: 170, duration: 20 },   // Near RGIA
			{ lat: 17.32,  lon: 78.40,  altitude: 10000, heading: 240, duration: 20 },   // Go-around
			{ lat: 17.35,  lon: 78.30,  altitude: 16000, heading: 300, duration: 25 },
			{ lat: 17.42,  lon: 78.22,  altitude: 22000, heading: 340, duration: 25 },
			{ lat: 17.52,  lon: 78.18,  altitude: 26000, heading: 20,  duration: 30 },
		],
	},
	{
		id: 'hyderabad-scenic',
		locationId: 'hyderabad',
		name: 'Hyderabad Lakes Circuit',
		loop: true,
		preferredTime: 'day',
		waypoints: [
			{ lat: 17.48,  lon: 78.32,  altitude: 26000, heading: 90,  duration: 0 },
			{ lat: 17.50,  lon: 78.44,  altitude: 26000, heading: 60,  duration: 30 },   // Over Hussain Sagar
			{ lat: 17.55,  lon: 78.50,  altitude: 25000, heading: 30,  duration: 25 },
			{ lat: 17.60,  lon: 78.48,  altitude: 25000, heading: 310, duration: 25 },
			{ lat: 17.58,  lon: 78.38,  altitude: 26000, heading: 230, duration: 30 },
			{ lat: 17.50,  lon: 78.30,  altitude: 26000, heading: 200, duration: 25 },
			{ lat: 17.44,  lon: 78.28,  altitude: 26000, heading: 140, duration: 25 },
		],
	},

	// ---- DALLAS ----

	{
		id: 'dallas-departure',
		locationId: 'dallas',
		name: 'DFW Departure Climb',
		loop: true,
		preferredTime: 'dawn',
		waypoints: [
			{ lat: 32.90,  lon: -97.04, altitude: 5000,  heading: 180, duration: 0 },    // DFW runway heading
			{ lat: 32.84,  lon: -97.02, altitude: 10000, heading: 170, duration: 20 },
			{ lat: 32.76,  lon: -96.95, altitude: 18000, heading: 150, duration: 25 },
			{ lat: 32.70,  lon: -96.85, altitude: 24000, heading: 130, duration: 25 },
			{ lat: 32.68,  lon: -96.72, altitude: 30000, heading: 90,  duration: 25 },    // Heading east
			{ lat: 32.72,  lon: -96.58, altitude: 32000, heading: 45,  duration: 30 },
			{ lat: 32.82,  lon: -96.50, altitude: 34000, heading: 350, duration: 30 },
			{ lat: 32.92,  lon: -96.60, altitude: 34000, heading: 280, duration: 30 },
			{ lat: 32.96,  lon: -96.78, altitude: 32000, heading: 240, duration: 30 },
			{ lat: 32.94,  lon: -96.95, altitude: 20000, heading: 210, duration: 30 },
		],
	},
	{
		id: 'dallas-cruise',
		locationId: 'dallas',
		name: 'Dallas Metroplex Tour',
		loop: true,
		preferredTime: 'any',
		waypoints: [
			{ lat: 32.85,  lon: -96.85, altitude: 30000, heading: 90,  duration: 0 },
			{ lat: 32.82,  lon: -96.70, altitude: 30000, heading: 120, duration: 30 },
			{ lat: 32.74,  lon: -96.60, altitude: 29000, heading: 180, duration: 30 },    // Downtown Dallas
			{ lat: 32.66,  lon: -96.65, altitude: 29000, heading: 230, duration: 30 },
			{ lat: 32.62,  lon: -96.80, altitude: 30000, heading: 270, duration: 30 },
			{ lat: 32.68,  lon: -96.98, altitude: 30000, heading: 330, duration: 30 },    // Fort Worth side
			{ lat: 32.78,  lon: -97.02, altitude: 30000, heading: 20,  duration: 30 },
			{ lat: 32.88,  lon: -96.95, altitude: 30000, heading: 50,  duration: 30 },
		],
	},

	// ---- PHOENIX ----

	{
		id: 'phoenix-approach',
		locationId: 'phoenix',
		name: 'Phoenix Desert Approach',
		loop: true,
		preferredTime: 'dusk',
		waypoints: [
			{ lat: 33.60,  lon: -112.20, altitude: 30000, heading: 170, duration: 0 },
			{ lat: 33.55,  lon: -112.15, altitude: 24000, heading: 155, duration: 25 },
			{ lat: 33.50,  lon: -112.08, altitude: 18000, heading: 140, duration: 25 },
			{ lat: 33.45,  lon: -112.00, altitude: 12000, heading: 130, duration: 25 },   // Scottsdale
			{ lat: 33.42,  lon: -111.92, altitude: 8000,  heading: 160, duration: 20 },
			{ lat: 33.38,  lon: -111.98, altitude: 7000,  heading: 220, duration: 20 },   // Near Sky Harbor
			{ lat: 33.40,  lon: -112.10, altitude: 10000, heading: 280, duration: 20 },   // Go-around
			{ lat: 33.45,  lon: -112.20, altitude: 18000, heading: 320, duration: 25 },
			{ lat: 33.52,  lon: -112.25, altitude: 26000, heading: 350, duration: 30 },
		],
	},
	{
		id: 'phoenix-scenic',
		locationId: 'phoenix',
		name: 'Sonoran Desert Scenic',
		loop: true,
		preferredTime: 'day',
		waypoints: [
			{ lat: 33.50,  lon: -112.10, altitude: 28000, heading: 45,  duration: 0 },
			{ lat: 33.55,  lon: -111.95, altitude: 28000, heading: 70,  duration: 30 },   // Camelback Mountain
			{ lat: 33.52,  lon: -111.80, altitude: 27000, heading: 140, duration: 30 },
			{ lat: 33.42,  lon: -111.78, altitude: 26000, heading: 200, duration: 30 },   // Superstition Mtns
			{ lat: 33.35,  lon: -111.90, altitude: 26000, heading: 250, duration: 30 },
			{ lat: 33.38,  lon: -112.08, altitude: 27000, heading: 310, duration: 30 },
			{ lat: 33.45,  lon: -112.15, altitude: 28000, heading: 350, duration: 30 },
		],
	},

	// ---- LAS VEGAS ----

	{
		id: 'las_vegas-night',
		locationId: 'las_vegas',
		name: 'Las Vegas Strip Night Arrival',
		loop: true,
		preferredTime: 'night',
		waypoints: [
			{ lat: 36.30,  lon: -115.30, altitude: 25000, heading: 140, duration: 0 },
			{ lat: 36.25,  lon: -115.22, altitude: 20000, heading: 145, duration: 25 },
			{ lat: 36.20,  lon: -115.16, altitude: 15000, heading: 155, duration: 25 },
			{ lat: 36.15,  lon: -115.14, altitude: 10000, heading: 170, duration: 25 },   // Strip visible
			{ lat: 36.10,  lon: -115.16, altitude: 8000,  heading: 200, duration: 20 },   // Over the Strip
			{ lat: 36.06,  lon: -115.20, altitude: 7000,  heading: 230, duration: 20 },   // Near McCarran
			{ lat: 36.08,  lon: -115.28, altitude: 10000, heading: 300, duration: 20 },   // Go-around
			{ lat: 36.14,  lon: -115.32, altitude: 16000, heading: 340, duration: 25 },
			{ lat: 36.22,  lon: -115.34, altitude: 22000, heading: 10,  duration: 25 },
		],
	},
	{
		id: 'las_vegas-cruise',
		locationId: 'las_vegas',
		name: 'Las Vegas Valley Circuit',
		loop: true,
		preferredTime: 'day',
		waypoints: [
			{ lat: 36.20,  lon: -115.20, altitude: 26000, heading: 60,  duration: 0 },
			{ lat: 36.25,  lon: -115.08, altitude: 26000, heading: 40,  duration: 30 },   // Red Rock Canyon
			{ lat: 36.30,  lon: -115.00, altitude: 25000, heading: 80,  duration: 30 },
			{ lat: 36.28,  lon: -114.88, altitude: 25000, heading: 160, duration: 30 },   // Lake Mead
			{ lat: 36.18,  lon: -114.90, altitude: 26000, heading: 220, duration: 30 },
			{ lat: 36.12,  lon: -115.05, altitude: 26000, heading: 260, duration: 30 },
			{ lat: 36.14,  lon: -115.18, altitude: 26000, heading: 320, duration: 30 },
		],
	},

	// ---- HIMALAYAS ----

	{
		id: 'himalayas-scenic',
		locationId: 'himalayas',
		name: 'Everest Ridgeline Scenic',
		loop: true,
		preferredTime: 'dawn',
		waypoints: [
			{ lat: 27.85,  lon: 86.70,  altitude: 38000, heading: 60,  duration: 0 },
			{ lat: 27.90,  lon: 86.80,  altitude: 37000, heading: 70,  duration: 30 },
			{ lat: 27.95,  lon: 86.92,  altitude: 36000, heading: 80,  duration: 30 },    // Near Everest
			{ lat: 28.00,  lon: 87.05,  altitude: 37000, heading: 50,  duration: 30 },
			{ lat: 28.08,  lon: 87.12,  altitude: 38000, heading: 20,  duration: 30 },    // Makalu view
			{ lat: 28.12,  lon: 87.05,  altitude: 38000, heading: 300, duration: 30 },
			{ lat: 28.08,  lon: 86.90,  altitude: 37000, heading: 240, duration: 30 },
			{ lat: 28.00,  lon: 86.78,  altitude: 37000, heading: 210, duration: 25 },
			{ lat: 27.92,  lon: 86.72,  altitude: 38000, heading: 190, duration: 25 },
		],
	},
	{
		id: 'himalayas-flyover',
		locationId: 'himalayas',
		name: 'Himalayan Range Flyover',
		loop: true,
		preferredTime: 'day',
		waypoints: [
			{ lat: 27.70,  lon: 86.60,  altitude: 40000, heading: 45,  duration: 0 },
			{ lat: 27.80,  lon: 86.75,  altitude: 39000, heading: 55,  duration: 30 },
			{ lat: 27.90,  lon: 86.90,  altitude: 38000, heading: 65,  duration: 30 },    // Everest pass
			{ lat: 28.00,  lon: 87.10,  altitude: 38000, heading: 70,  duration: 30 },
			{ lat: 28.08,  lon: 87.25,  altitude: 39000, heading: 50,  duration: 30 },
			{ lat: 28.15,  lon: 87.20,  altitude: 40000, heading: 310, duration: 25 },    // Turn back
			{ lat: 28.10,  lon: 87.05,  altitude: 40000, heading: 250, duration: 30 },
			{ lat: 28.00,  lon: 86.85,  altitude: 39000, heading: 230, duration: 30 },
			{ lat: 27.88,  lon: 86.70,  altitude: 39000, heading: 210, duration: 25 },
			{ lat: 27.78,  lon: 86.62,  altitude: 40000, heading: 200, duration: 25 },
		],
	},

	// ---- PACIFIC OCEAN ----

	{
		id: 'ocean-longhaul',
		locationId: 'ocean',
		name: 'Pacific Long-Haul Cruise',
		loop: true,
		preferredTime: 'any',
		waypoints: [
			{ lat: 21.40,  lon: -157.95, altitude: 42000, heading: 250, duration: 0 },
			{ lat: 21.35,  lon: -158.10, altitude: 42000, heading: 245, duration: 40 },
			{ lat: 21.28,  lon: -158.25, altitude: 41000, heading: 240, duration: 40 },
			{ lat: 21.22,  lon: -158.38, altitude: 41000, heading: 235, duration: 40 },
			{ lat: 21.20,  lon: -158.48, altitude: 42000, heading: 200, duration: 35 },   // Gradual turn
			{ lat: 21.25,  lon: -158.42, altitude: 42000, heading: 50,  duration: 35 },
			{ lat: 21.32,  lon: -158.28, altitude: 41000, heading: 60,  duration: 40 },
			{ lat: 21.38,  lon: -158.10, altitude: 42000, heading: 65,  duration: 40 },
		],
	},
	{
		id: 'ocean-island',
		locationId: 'ocean',
		name: 'Hawaiian Island Hop',
		loop: true,
		preferredTime: 'day',
		waypoints: [
			{ lat: 21.35,  lon: -157.80, altitude: 38000, heading: 300, duration: 0 },
			{ lat: 21.45,  lon: -157.95, altitude: 36000, heading: 290, duration: 30 },   // Over Oahu
			{ lat: 21.50,  lon: -158.10, altitude: 34000, heading: 280, duration: 30 },
			{ lat: 21.48,  lon: -158.25, altitude: 32000, heading: 250, duration: 25 },   // Kaena Point
			{ lat: 21.40,  lon: -158.30, altitude: 34000, heading: 200, duration: 25 },
			{ lat: 21.30,  lon: -158.20, altitude: 36000, heading: 140, duration: 30 },
			{ lat: 21.25,  lon: -158.05, altitude: 37000, heading: 100, duration: 30 },
			{ lat: 21.28,  lon: -157.88, altitude: 38000, heading: 40,  duration: 30 },
		],
	},

	// ---- SAHARA DESERT ----

	{
		id: 'desert-expedition',
		locationId: 'desert',
		name: 'Sahara Expedition Cruise',
		loop: true,
		preferredTime: 'day',
		waypoints: [
			{ lat: 23.50,  lon: 25.50,  altitude: 35000, heading: 90,  duration: 0 },
			{ lat: 23.55,  lon: 25.70,  altitude: 34000, heading: 80,  duration: 35 },
			{ lat: 23.60,  lon: 25.90,  altitude: 33000, heading: 70,  duration: 35 },    // Dune fields
			{ lat: 23.62,  lon: 26.10,  altitude: 34000, heading: 60,  duration: 35 },
			{ lat: 23.58,  lon: 26.25,  altitude: 35000, heading: 180, duration: 30 },    // Turn south
			{ lat: 23.45,  lon: 26.20,  altitude: 35000, heading: 240, duration: 30 },
			{ lat: 23.38,  lon: 26.00,  altitude: 34000, heading: 260, duration: 30 },
			{ lat: 23.40,  lon: 25.75,  altitude: 34000, heading: 300, duration: 30 },
			{ lat: 23.48,  lon: 25.55,  altitude: 35000, heading: 340, duration: 25 },
		],
	},
	{
		id: 'desert-dusk',
		locationId: 'desert',
		name: 'Sahara Sunset Run',
		loop: true,
		preferredTime: 'dusk',
		waypoints: [
			{ lat: 23.30,  lon: 25.40,  altitude: 32000, heading: 270, duration: 0 },
			{ lat: 23.35,  lon: 25.25,  altitude: 30000, heading: 280, duration: 30 },    // Heading west into sun
			{ lat: 23.40,  lon: 25.08,  altitude: 28000, heading: 290, duration: 30 },
			{ lat: 23.48,  lon: 24.95,  altitude: 28000, heading: 10,  duration: 30 },    // Turn north
			{ lat: 23.55,  lon: 25.00,  altitude: 30000, heading: 70,  duration: 25 },
			{ lat: 23.55,  lon: 25.18,  altitude: 31000, heading: 100, duration: 25 },
			{ lat: 23.48,  lon: 25.35,  altitude: 32000, heading: 170, duration: 25 },
			{ lat: 23.38,  lon: 25.38,  altitude: 32000, heading: 230, duration: 25 },
		],
	},

	// ---- ABOVE CLOUDS (Japan) ----

	{
		id: 'clouds-serene',
		locationId: 'clouds',
		name: 'Serene High-Altitude Drift',
		loop: true,
		preferredTime: 'any',
		waypoints: [
			{ lat: 35.70,  lon: 139.55, altitude: 45000, heading: 40,  duration: 0 },
			{ lat: 35.78,  lon: 139.65, altitude: 46000, heading: 50,  duration: 40 },
			{ lat: 35.82,  lon: 139.80, altitude: 47000, heading: 80,  duration: 40 },
			{ lat: 35.78,  lon: 139.95, altitude: 47000, heading: 140, duration: 35 },
			{ lat: 35.68,  lon: 140.00, altitude: 46000, heading: 210, duration: 35 },
			{ lat: 35.60,  lon: 139.85, altitude: 45000, heading: 250, duration: 35 },
			{ lat: 35.62,  lon: 139.65, altitude: 45000, heading: 320, duration: 35 },
		],
	},
	{
		id: 'clouds-fuji',
		locationId: 'clouds',
		name: 'Mount Fuji Scenic Pass',
		loop: true,
		preferredTime: 'dawn',
		waypoints: [
			{ lat: 35.50,  lon: 139.50, altitude: 42000, heading: 250, duration: 0 },
			{ lat: 35.45,  lon: 139.35, altitude: 40000, heading: 240, duration: 30 },
			{ lat: 35.40,  lon: 139.18, altitude: 38000, heading: 230, duration: 30 },    // Near Fuji
			{ lat: 35.35,  lon: 139.00, altitude: 36000, heading: 220, duration: 30 },
			{ lat: 35.32,  lon: 138.85, altitude: 38000, heading: 180, duration: 25 },    // South of Fuji
			{ lat: 35.35,  lon: 138.90, altitude: 40000, heading: 50,  duration: 25 },    // Turn back
			{ lat: 35.42,  lon: 139.05, altitude: 42000, heading: 55,  duration: 30 },
			{ lat: 35.50,  lon: 139.22, altitude: 44000, heading: 60,  duration: 30 },
			{ lat: 35.55,  lon: 139.40, altitude: 45000, heading: 70,  duration: 30 },
		],
	},
];

// ============================================================================
// LOOKUP
// ============================================================================

/** All scenarios grouped by locationId */
const SCENARIOS_BY_LOCATION = new Map<LocationId, FlightScenario[]>();
for (const s of SCENARIOS) {
	const existing = SCENARIOS_BY_LOCATION.get(s.locationId) ?? [];
	existing.push(s);
	SCENARIOS_BY_LOCATION.set(s.locationId, existing);
}

/**
 * Pick a scenario for the given location, preferring one that matches the current sky state.
 * Falls back to 'any' scenarios, then any scenario for that location.
 */
export function pickScenario(locationId: LocationId, skyState: SkyState): FlightScenario | null {
	const pool = SCENARIOS_BY_LOCATION.get(locationId);
	if (!pool || pool.length === 0) return null;

	// Score scenarios: exact time match = 3, 'any' = 1, mismatch = 0
	const scored = pool.map(s => ({
		scenario: s,
		score: s.preferredTime === skyState ? 3
			: s.preferredTime === 'any' ? 1
			: 0,
	}));

	// Filter to only viable scenarios (score > 0)
	const viable = scored.filter(s => s.score > 0);
	const candidates = viable.length > 0 ? viable : scored;

	// Weighted random pick (higher score = higher chance)
	const totalWeight = candidates.reduce((sum, c) => sum + Math.max(c.score, 0.5), 0);
	let roll = Math.random() * totalWeight;
	for (const c of candidates) {
		roll -= Math.max(c.score, 0.5);
		if (roll <= 0) return c.scenario;
	}

	return candidates[candidates.length - 1].scenario;
}

/**
 * Get all scenarios (for debug/UI listing).
 */
export function getAllScenarios(): readonly FlightScenario[] {
	return SCENARIOS;
}
