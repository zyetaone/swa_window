/**
 * parallax.ts — Multi-Pi Panoramic Window Wall Role and Camera Yaw Math.
 */

export type FleetRole = 'solo' | 'center' | 'left' | 'right';

export const PANORAMA_ARC_DEG = 72;

export function roleYawOffsetDeg(role: FleetRole): number {
	switch (role) {
		case 'left':
			return -(PANORAMA_ARC_DEG / 2 - PANORAMA_ARC_DEG / 6); // -24 deg
		case 'right':
			return +(PANORAMA_ARC_DEG / 2 - PANORAMA_ARC_DEG / 6); // +24 deg
		case 'center':
		case 'solo':
		default:
			return 0;
	}
}

export function isLeader(role: FleetRole): boolean {
	return role === 'solo' || role === 'center';
}

export function isEdge(role: FleetRole): boolean {
	return role === 'left' || role === 'right';
}
