
import { type SkyState, type SunPosition } from '../types';

export function getSkyState(timeOfDay: number): SkyState {
    if (timeOfDay < 5 || timeOfDay > 20) return 'night';
    if (timeOfDay < 7) return 'dawn';
    if (timeOfDay > 18) return 'dusk';
    return 'day';
}

/**
 * Calculate sun position for Three.js that matches Cesium's sun position.
 *
 * Coordinate system (Three.js default, matching Cesium's East-North-Up):
 * - +X = East
 * - +Y = Up (zenith)
 * - +Z = North
 *
 * Sun path:
 * - 6am (sunrise): East, low on horizon
 * - 12pm (solar noon): South, highest point
 * - 6pm (sunset): West, low on horizon
 * - Night: Below horizon
 */
export function calculateSunPosition(timeOfDay: number): SunPosition {
    // Solar hour angle: 0 at noon, negative in morning, positive in afternoon
    // Ranges from -180° (midnight) to +180° (midnight)
    const solarHourAngle = (timeOfDay - 12) * 15; // 15 degrees per hour
    const hourAngleRad = (solarHourAngle * Math.PI) / 180;

    // Simplified declination (assume equinox, sun on equator)
    // For full accuracy, would need day of year
    const declination = 0; // radians (0 = equinox)

    // Approximate latitude for mid-latitudes (25° N like Dubai)
    const latitude = 25 * Math.PI / 180;

    // Calculate solar elevation (altitude above horizon)
    // sin(elevation) = sin(lat)*sin(dec) + cos(lat)*cos(dec)*cos(hourAngle)
    const sinElevation = Math.sin(latitude) * Math.sin(declination) +
                         Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngleRad);
    const elevation = Math.asin(Math.max(-1, Math.min(1, sinElevation)));

    // Calculate azimuth (compass direction)
    // sin(azimuth) = -sin(hourAngle)*cos(dec) / cos(elevation)
    const cosElevation = Math.cos(elevation);
    let azimuth = 0;
    if (Math.abs(cosElevation) > 0.001) {
        const sinAzimuth = -Math.sin(hourAngleRad) * Math.cos(declination) / cosElevation;
        const cosAzimuth = (Math.sin(declination) - Math.sin(latitude) * sinElevation) /
                          (Math.cos(latitude) * cosElevation);
        azimuth = Math.atan2(sinAzimuth, cosAzimuth);
    }

    // Convert spherical to Cartesian (ENU - East, North, Up convention)
    // Azimuth is from North, clockwise: 0=N, 90=E, 180=S, 270=W
    // For Three.js: X=East, Y=Up, Z=North (so we need to adjust)
    const distance = 1000; // Arbitrary distance for direction vector

    // In ENU: East = sin(azimuth), North = cos(azimuth)
    const x = distance * Math.cos(elevation) * Math.sin(azimuth);  // East
    const y = distance * Math.sin(elevation);                       // Up
    const z = distance * Math.cos(elevation) * Math.cos(azimuth);  // North

    // Normalize height to 0-1 range for shader use (above horizon)
    const normalizedHeight = Math.max(0, Math.sin(elevation));

    return {
        x,
        y,
        z,
        azimuth: azimuth * 180 / Math.PI, // Convert to degrees for readability
        height: normalizedHeight
    };
}
