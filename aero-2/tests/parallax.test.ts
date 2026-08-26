import { describe, it, expect } from 'vitest';
import { roleYawOffsetDeg, isLeader, isEdge } from '../src/lib/display/flight/parallax.js';

describe('Parallax role math', () => {
	it('computes 0 offset for solo and center roles', () => {
		expect(roleYawOffsetDeg('solo')).toBe(0);
		expect(roleYawOffsetDeg('center')).toBe(0);
	});

	it('computes symmetric yaw offsets for left and right edge panes', () => {
		const leftOffset = roleYawOffsetDeg('left');
		const rightOffset = roleYawOffsetDeg('right');

		expect(leftOffset).toBe(-24);
		expect(rightOffset).toBe(+24);
		expect(leftOffset + rightOffset).toBe(0);
	});

	it('identifies leader and edge panes correctly', () => {
		expect(isLeader('solo')).toBe(true);
		expect(isLeader('center')).toBe(true);
		expect(isLeader('left')).toBe(false);
		expect(isLeader('right')).toBe(false);

		expect(isEdge('left')).toBe(true);
		expect(isEdge('right')).toBe(true);
		expect(isEdge('solo')).toBe(false);
		expect(isEdge('center')).toBe(false);
	});
});
