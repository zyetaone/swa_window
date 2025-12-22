/**
 * Math Utilities
 *
 * Shared mathematical functions used across the application.
 * Consolidates duplicate lerp, easing, and utility functions.
 */

/**
 * Linear interpolation between two values
 * @param current - Starting value
 * @param target - Target value
 * @param factor - Interpolation factor (0-1)
 * @returns Interpolated value
 */
export function lerp(current: number, target: number, factor: number): number {
	return current + (target - current) * factor;
}

/**
 * Lerp for angles with proper wrap-around handling
 * Handles 0/360 degree boundary correctly
 * @param current - Current angle in degrees
 * @param target - Target angle in degrees
 * @param factor - Interpolation factor (0-1)
 * @returns Interpolated angle in degrees (0-360)
 */
export function lerpAngle(current: number, target: number, factor: number): number {
	let diff = target - current;
	// Handle wrap-around
	if (diff > 180) diff -= 360;
	if (diff < -180) diff += 360;
	let result = current + diff * factor;
	// Normalize to 0-360
	if (result < 0) result += 360;
	if (result >= 360) result -= 360;
	return result;
}

/**
 * Clamp a value between min and max
 * @param value - Value to clamp
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Clamped value
 */
export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * Cubic ease-in-out function
 * Smooth acceleration and deceleration
 * @param t - Progress value (0-1)
 * @returns Eased value (0-1)
 */
export function easeInOutCubic(t: number): number {
	return t < 0.5
		? 4 * t * t * t
		: 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Quadratic ease-in-out function
 * Gentler acceleration/deceleration than cubic
 * @param t - Progress value (0-1)
 * @returns Eased value (0-1)
 */
export function easeInOut(t: number): number {
	return t < 0.5
		? 2 * t * t
		: 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Smooth interpolation (cubic hermite)
 * Same as GLSL smoothstep function
 * @param t - Value to smooth (0-1)
 * @returns Smoothed value (0-1)
 */
export function smoothstep(t: number): number {
	return t * t * (3 - 2 * t);
}

/**
 * Normalize angle to 0-360 range
 * @param angle - Angle in degrees
 * @returns Normalized angle (0-360)
 */
export function normalizeAngle(angle: number): number {
	let normalized = angle % 360;
	if (normalized < 0) normalized += 360;
	return normalized;
}

/**
 * Convert degrees to radians
 * @param degrees - Angle in degrees
 * @returns Angle in radians
 */
export function degToRad(degrees: number): number {
	return degrees * Math.PI / 180;
}

/**
 * Convert radians to degrees
 * @param radians - Angle in radians
 * @returns Angle in degrees
 */
export function radToDeg(radians: number): number {
	return radians * 180 / Math.PI;
}

/**
 * Frame-rate independent smoothing factor
 * Converts a per-frame smoothing value to be framerate independent
 * @param smoothing - Smoothing factor per frame at 60fps (0-1)
 * @param deltaTime - Time since last frame in seconds
 * @returns Frame-rate independent smoothing factor
 */
export function frameRateIndependentSmoothing(smoothing: number, deltaTime: number): number {
	return 1 - Math.pow(1 - smoothing, deltaTime * 60);
}

/**
 * Map a value from one range to another
 * @param value - Input value
 * @param inMin - Input range minimum
 * @param inMax - Input range maximum
 * @param outMin - Output range minimum
 * @param outMax - Output range maximum
 * @returns Mapped value
 */
export function mapRange(
	value: number,
	inMin: number,
	inMax: number,
	outMin: number,
	outMax: number
): number {
	return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}
