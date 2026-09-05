/**
 * useMouseParallax — cursor-driven scene parallax.
 *
 * The classic "Three.js demo" interactivity: cursor position relative to
 * viewport center maps to a small CSS translate offset on the scene-content
 * wrapper, giving the viewer a "looking around" feel without affecting the
 * Cesium camera state.
 *
 * Smoothing: target offset updates on mousemove, actual offset lerps toward
 * target each RAF tick. Lerp coefficient 0.14 ≈ 110ms time-constant.
 *
 * Gating: config.shell.mouseParallax (default OFF — kiosk has no cursor).
 * When disabled or settled at rest, we stop writing $state so Pane's
 * motionTransform is not invalidated 60×/s for a no-op.
 *
 * Why DOM transform vs. Cesium camera nudge: the camera nudge would trigger
 * tile re-evaluation and break the existing flight engine's smooth camera
 * lerp. DOM transform on .scene-content is a pure visual offset of the
 * already-rendered frame — zero Cesium impact.
 */

import { config } from '$lib/model/config-tree.svelte';
import { subscribe } from '$lib/game-loop';

const MAX_OFFSET_X = 12; // pixels at viewport edge
const MAX_OFFSET_Y = 8;
const LERP = 0.14; // 0.14 ≈ 110ms time constant @ 60fps
/** Skip $state writes when motion is visually zero (stops style thrash). */
const SETTLE_EPS = 0.02;

export function useMouseParallax(): { readonly x: number; readonly y: number } {
	let current = $state({ x: 0, y: 0 });
	let target = { x: 0, y: 0 };

	$effect(() => {
		if (!config.shell.mouseParallax) {
			target = { x: 0, y: 0 };
			// Snap settled so the next frame can drop the RAF writer.
			if (Math.abs(current.x) > SETTLE_EPS || Math.abs(current.y) > SETTLE_EPS) {
				current = { x: 0, y: 0 };
			}
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

	// Shared game loop — only subscribed while parallax is enabled so a
	// kiosk (default off) pays nothing per frame.
	$effect(() => {
		if (!config.shell.mouseParallax) return;
		return subscribe(() => {
			const nx = current.x + (target.x - current.x) * LERP;
			const ny = current.y + (target.y - current.y) * LERP;
			const atRest =
				Math.abs(nx) < SETTLE_EPS &&
				Math.abs(ny) < SETTLE_EPS &&
				Math.abs(target.x) < SETTLE_EPS &&
				Math.abs(target.y) < SETTLE_EPS;
			if (atRest) {
				if (current.x !== 0 || current.y !== 0) current = { x: 0, y: 0 };
				return;
			}
			// Only invalidate when the delta is visible.
			if (Math.abs(nx - current.x) < SETTLE_EPS && Math.abs(ny - current.y) < SETTLE_EPS) return;
			current = { x: nx, y: ny };
		});
	});

	return {
		get x() { return current.x; },
		get y() { return current.y; },
	};
}
