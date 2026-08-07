/**
 * useMouseParallax — cursor-driven scene parallax.
 *
 * The classic "Three.js demo" interactivity: cursor position relative to
 * viewport center maps to a small CSS translate offset on the scene-content
 * wrapper, giving the viewer a "looking around" feel without affecting the
 * Cesium camera state.
 *
 * Smoothing: target offset updates on mousemove, actual offset lerps toward
 * target each RAF tick. Lerp coefficient 0.08 ≈ 200ms time-constant — slow
 * enough to feel deliberate, fast enough to track quick cursor moves.
 *
 * Gating: config.shell.mouseParallax toggle. Cursor leaving viewport resets
 * target to (0, 0) so it smoothly returns to neutral.
 *
 * Why DOM transform vs. Cesium camera nudge: the camera nudge would trigger
 * tile re-evaluation and break the existing flight engine's smooth camera
 * lerp. DOM transform on .scene-content is a pure visual offset of the
 * already-rendered frame — zero Cesium impact, super cheap, classic
 * Three.js demo feel.
 */

import { config } from '$lib/model/config-tree.svelte';
import { subscribe } from '$lib/game-loop';

const MAX_OFFSET_X = 12; // pixels at viewport edge
const MAX_OFFSET_Y = 8;
const LERP = 0.14; // 0.14 ≈ 110ms time constant @ 60fps — snappier per user

export function useMouseParallax(): { readonly x: number; readonly y: number } {
	let current = $state({ x: 0, y: 0 });
	let target = { x: 0, y: 0 };

	$effect(() => {
		if (!config.shell.mouseParallax) {
			target = { x: 0, y: 0 };
			return;
		}

		const onMove = (e: MouseEvent) => {
			const cx = window.innerWidth / 2;
			const cy = window.innerHeight / 2;
			target = {
				x: ((e.clientX - cx) / cx) * MAX_OFFSET_X,
				y: ((e.clientY - cy) / cy) * MAX_OFFSET_Y,
			};
		};
		const onLeave = () => {
			target = { x: 0, y: 0 };
		};
		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseleave', onLeave);
		return () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseleave', onLeave);
		};
	});

	// The shared game loop, not a private RAF: one animation-frame source
	// (visibility-aware — a hidden tab stops lerping instead of burning
	// frames), same pattern as GlobeLayer's tick subscription.
	$effect(() => subscribe(() => {
		current = {
			x: current.x + (target.x - current.x) * LERP,
			y: current.y + (target.y - current.y) * LERP,
		};
	}));

	return {
		get x() { return current.x; },
		get y() { return current.y; },
	};
}
