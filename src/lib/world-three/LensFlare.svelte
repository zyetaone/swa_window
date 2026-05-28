<script lang="ts">
	/**
	 * LensFlare — Three.js Lensflare addon at the sun's world position.
	 *
	 * Drives the golden-hour cinema look: when the sun is in or near the
	 * camera frustum, screen-space ghost flares paint along the line from
	 * the sun to the screen centre. The Lensflare addon handles all the
	 * screen-space projection internally — we just place the parent
	 * PointLight at the sun's direction × placement radius.
	 *
	 * Texture is a procedural radial gradient (same pattern SunGlow uses
	 * but smaller + warmer-biased).
	 *
	 * Imperative (uses ctx.scene.add) because Lensflare is a non-T-proxied
	 * Three.js Object3D that lives outside Threlte's declarative tree.
	 */
	import { useThrelte } from '@threlte/core';
	import { onDestroy } from 'svelte';
	import {
		PointLight,
		Color,
		CanvasTexture,
		SRGBColorSpace,
		LinearFilter,
	} from 'three';
	import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { computeSunDirection } from './state.svelte';

	const model = useAeroWindow();
	const ctx = useThrelte();

	// Match SunGlow's sun-placement so the flare ghosts originate from the
	// exact same world point as the sun core/halo billboards.
	const SUN_PLACEMENT_M = 6e7;

	function makeGhostTexture(): CanvasTexture {
		const size = 128;
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = size;
		const ctx2d = canvas.getContext('2d')!;
		const r = size / 2;
		const grad = ctx2d.createRadialGradient(r, r, 0, r, r, r);
		grad.addColorStop(0,    'rgba(255, 255, 255, 1.0)');
		grad.addColorStop(0.3,  'rgba(255, 220, 160, 0.6)');
		grad.addColorStop(0.7,  'rgba(255, 160, 80, 0.18)');
		grad.addColorStop(1.0,  'rgba(0, 0, 0, 0)');
		ctx2d.fillStyle = grad;
		ctx2d.fillRect(0, 0, size, size);
		const tex = new CanvasTexture(canvas);
		tex.colorSpace = SRGBColorSpace;
		tex.minFilter = LinearFilter;
		tex.magFilter = LinearFilter;
		return tex;
	}

	const ghost = makeGhostTexture();

	// The light is a vessel for Lensflare — its actual lighting contribution
	// is irrelevant (we set intensity=0). What matters is its world position,
	// which Lensflare uses for screen-space projection.
	const light = new PointLight(0xffffff, 0);

	const flare = new Lensflare();
	// Store elements so we can scale them with air mass (less fake).
	const anchorGhost = new LensflareElement(ghost, 520, 0,    new Color(1.0, 0.85, 0.50)); // slightly smaller base
	const g1 = new LensflareElement(ghost, 85, 0.30, new Color(1.0, 0.65, 0.30));
	const g2 = new LensflareElement(ghost, 60,  0.55, new Color(1.0, 0.50, 0.25));
	const g3 = new LensflareElement(ghost, 120, 0.78, new Color(1.0, 0.75, 0.45));
	const g4 = new LensflareElement(ghost, 42,  0.95, new Color(1.0, 0.90, 0.60));
	flare.addElement(anchorGhost);
	flare.addElement(g1);
	flare.addElement(g2);
	flare.addElement(g3);
	flare.addElement(g4);
	light.add(flare);

	ctx.scene.add(light);

	$effect(() => {
		const dir = computeSunDirection(model.flight.camLon, model.timeOfDay);
		light.position.set(
			dir[0] * SUN_PLACEMENT_M,
			dir[1] * SUN_PLACEMENT_M,
			dir[2] * SUN_PLACEMENT_M,
		);

		// Lens flare aggressively driven by air mass: strong cinematic ghosts only
		// when sun is low (thick air path); near-zero when high in sky or at night.
		// Tighter floor + higher power + lower base coeffs = disappears fast as sun rises.
		const elev = Math.max(0.06, dir[1]);
		const airMass = 1.0 / elev;
		let vis = Math.pow(airMass * 0.48, 1.72) * (1 - model.nightFactor * 0.93);
		vis = Math.min(vis, 1.15) * 0.78;

		// Much more aggressive ghost scaling — high sun → tiny or invisible ghosts.
		const ghostScale = Math.max(0.14, Math.min(1.08, airMass * 0.31));
		anchorGhost.size = 520 * ghostScale;
		g1.size = 85 * ghostScale;
		g2.size = 60 * ghostScale;
		g3.size = 120 * ghostScale;
		g4.size = 42 * ghostScale;

		light.visible = vis > 0.09;
	});

	onDestroy(() => {
		ctx.scene.remove(light);
		light.remove(flare);
		// Lensflare.dispose exists on the addon's class.
		(flare as unknown as { dispose: () => void }).dispose?.();
		ghost.dispose();
	});
</script>
