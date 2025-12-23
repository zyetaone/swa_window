
import { type SkyState, type SunPosition } from '../types';

export function getSkyState(timeOfDay: number): SkyState {
	/**
	 * Determine sky state based on time of day (hours, 0-24)
	 * Time thresholds:
	 * - Night: before 5:00 or after 20:00
	 * - Dawn: 5:00 - 7:00 (sunrise period)
	 * - Day: 7:00 - 18:00 (full daylight)
	 * - Dusk: 18:00 - 20:00 (sunset period)
	 */
    if (timeOfDay < 5 || timeOfDay > 20) return 'night';
    if (timeOfDay < 7) return 'dawn';
    if (timeOfDay > 18) return 'dusk';
    return 'day';
}

/**
 * Calculate sun position for Three.js that matches Cesium's sun position.
 *
 * Coordinate System Details:
 * - Three.js uses a right-handed coordinate system:
 *   - +X = East
 *   - +Y = Up (zenith, pointing away from Earth center)
 *   - +Z = North
 * - Cesium uses similar ENU (East-North-Up) for local coordinates
 *
 * Solar Path (Northern Hemisphere, mid-latitudes):
 * - 6am (sunrise): East (+X), low elevation (~0°)
 * - 9am (morning): Northeast, rising elevation (~45°)
 * - 12pm (solar noon): South (-Z), highest elevation (~60-90° depending on latitude)
 * - 3pm (afternoon): Southwest, descending elevation (~45°)
 * - 6pm (sunset): West (-X), low elevation (~0°)
 * - Night: Below horizon (negative elevation)
 *
 * Calculation Details:
 * - Solar hour angle: 0° at noon, negative in morning, positive in afternoon
 * - Solar declination: Approximated as 0° (equinox) for simplicity
 *   - Full accuracy would require day-of-year calculation
 * - Latitude: Uses actual location latitude (defaults to 25°N)
 * - Elevation: Angle above horizon (-90° to +90°)
 * - Azimuth: Compass direction from North (0°=N, 90°=E, 180°=S, 270°=W)
 *
 * Returns:
 * - x, y, z: Cartesian coordinates for Three.js light position
 * - azimuth: Compass angle in degrees for reference
 * - height: Normalized 0-1 value for shader use (0=below horizon, 1=zenith)
 */
export function calculateSunPosition(timeOfDay: number, latitudeDeg: number = 25): SunPosition {
    // Solar hour angle: 0 at noon, negative in morning, positive in afternoon
    // Ranges from -180° (midnight) to +180° (midnight)
    const solarHourAngle = (timeOfDay - 12) * 15; // 15 degrees per hour
    const hourAngleRad = (solarHourAngle * Math.PI) / 180;

    // Simplified declination (assume equinox, sun on equator)
    // For full accuracy, would need day of year
    const declination = 0; // radians (0 = equinox)

    // Use actual latitude from model (defaults to 25°N like Dubai)
    const latitude = latitudeDeg * Math.PI / 180;

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
