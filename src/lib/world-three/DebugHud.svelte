<script lang="ts">
	/**
	 * DebugHud — diagnostic probe that runs INSIDE <Canvas> so it can use
	 * useThrelte() to inspect the live Three.js scene/renderer state.
	 *
	 * Publishes per-frame state to:
	 *   - `window.__aero3d`  (for external JS probes / Chrome MCP)
	 *   - bound `state` prop (for an on-screen HUD overlay)
	 *
	 * Why a child component (not a hook in ThreeViewer): useThrelte() only
	 * resolves the context once mounted inside <Canvas>. This file is the
	 * minimum surface needed to expose runtime state for debugging — it
	 * does NOT participate in rendering.
	 */
	import { useThrelte, useTask } from '@threlte/core';
	import { Vector2, type Object3D } from 'three';

	let {
		state = $bindable(),
	}: {
		state: {
			frame: number;
			drawCalls: number;
			triangles: number;
			sceneChildren: number;
			cameraPos: [number, number, number];
			cameraDist: number;
			rendererSize: [number, number];
		};
	} = $props();

	const ctx = useThrelte();

	useTask(() => {
		const cam = ctx.camera.current;
		const sz = ctx.renderer.getSize(new Vector2());
		// Walk top-level children of the scene to confirm what's mounted.
		const children: string[] = [];
		for (const c of ctx.scene.children as Object3D[]) {
			children.push(c.type + (c.name ? ':' + c.name : ''));
		}
		state.frame = ctx.renderer.info.render.frame;
		state.drawCalls = ctx.renderer.info.render.calls;
		state.triangles = ctx.renderer.info.render.triangles;
		state.sceneChildren = ctx.scene.children.length;
		state.cameraPos = [cam.position.x, cam.position.y, cam.position.z];
		state.cameraDist = cam.position.length();
		state.rendererSize = [sz.x, sz.y];

		// Surface to a global so an external probe (Chrome MCP JS) can read.
		(window as unknown as { __aero3d: unknown }).__aero3d = {
			...state,
			children,
		};
	});
</script>
