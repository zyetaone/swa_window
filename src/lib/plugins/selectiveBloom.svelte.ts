/**
 * Selective Bloom - Bloom effect only for objects on BLOOM_LAYER
 *
 * Uses native Three.js EffectComposer with UnrealBloomPass
 * Objects on layer 1 (BLOOM_LAYER) will have bloom applied
 *
 * Usage in Scene:
 * <script>
 *   import { layers } from '@threlte/extras'
 *   import { setupSelectiveBloom, BLOOM_LAYER } from '$lib/plugins/selectiveBloom'
 *
 *   layers()
 *   const { bloomComposer } = setupSelectiveBloom()
 * </script>
 *
 * <!-- Objects that should bloom -->
 * <T.Group layers={BLOOM_LAYER}>
 *   <CityLights />
 * </T.Group>
 */

import { useThrelte, useTask } from '@threlte/core';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import * as THREE from 'three';

// Layer for objects that should bloom
export const BLOOM_LAYER = 1;

export interface BloomOptions {
	/** Bloom intensity (default: 1) */
	intensity?: number;
	/** Bloom threshold (default: 0.8) */
	threshold?: number;
	/** Bloom radius/spread (default: 0.5) */
	radius?: number;
	/** Whether bloom is enabled (default: true) */
	enabled?: boolean;
}

// Final composite shader - combines bloom with base render
const compositeShader = {
	uniforms: {
		baseTexture: { value: null },
		bloomTexture: { value: null },
		bloomStrength: { value: 1 }
	},
	vertexShader: `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}
	`,
	fragmentShader: `
		uniform sampler2D baseTexture;
		uniform sampler2D bloomTexture;
		uniform float bloomStrength;
		varying vec2 vUv;
		void main() {
			vec4 base = texture2D(baseTexture, vUv);
			vec4 bloom = texture2D(bloomTexture, vUv);
			gl_FragColor = base + bloom * bloomStrength;
		}
	`
};

export function setupSelectiveBloom(options: BloomOptions = {}) {
	const { scene, camera, renderer, size } = useThrelte();

	const intensity = options.intensity ?? 1;
	const threshold = options.threshold ?? 0.8;
	const radius = options.radius ?? 0.5;
	let enabled = options.enabled ?? true;

	// Create bloom layer
	const bloomLayer = new THREE.Layers();
	bloomLayer.set(BLOOM_LAYER);

	// Materials cache for darken/restore
	const darkMaterial = new THREE.MeshBasicMaterial({ color: 'black' });
	const materials: Map<THREE.Object3D, THREE.Material | THREE.Material[]> = new Map();

	// Darken non-bloomed objects
	function darkenNonBloomed(obj: THREE.Object3D) {
		if ((obj as THREE.Mesh).isMesh && !bloomLayer.test(obj.layers)) {
			materials.set(obj, (obj as THREE.Mesh).material);
			(obj as THREE.Mesh).material = darkMaterial;
		}
	}

	// Restore materials
	function restoreMaterials(obj: THREE.Object3D) {
		if (materials.has(obj)) {
			(obj as THREE.Mesh).material = materials.get(obj)!;
			materials.delete(obj);
		}
	}

	// Set up composers
	const renderScene = new RenderPass(scene, camera.current);

	// Bloom composer (renders only bloom layer objects)
	const bloomComposer = new EffectComposer(renderer);
	bloomComposer.renderToScreen = false;
	bloomComposer.addPass(renderScene);

	const bloomPass = new UnrealBloomPass(
		new THREE.Vector2(size.current.width, size.current.height),
		intensity,
		radius,
		threshold
	);
	bloomComposer.addPass(bloomPass);

	// Final composer (composites bloom with base render)
	const finalComposer = new EffectComposer(renderer);
	finalComposer.addPass(renderScene);

	const compositePass = new ShaderPass(
		new THREE.ShaderMaterial({
			uniforms: {
				baseTexture: { value: null },
				bloomTexture: { value: null },
				bloomStrength: { value: intensity }
			},
			vertexShader: compositeShader.vertexShader,
			fragmentShader: compositeShader.fragmentShader,
			defines: {}
		}),
		'baseTexture'
	);
	compositePass.uniforms.bloomTexture.value = bloomComposer.renderTarget2.texture;
	compositePass.needsSwap = true;
	finalComposer.addPass(compositePass);

	// Handle resize
	$effect(() => {
		const { width, height } = size.current;
		bloomComposer.setSize(width, height);
		finalComposer.setSize(width, height);
		bloomPass.resolution.set(width, height);
	});

	// Render loop - runs every frame after scene updates
	useTask('selective-bloom', () => {
		if (!enabled) {
			renderer.render(scene, camera.current);
			return;
		}

		// Render bloom pass (darken non-bloom objects)
		scene.traverse(darkenNonBloomed);
		bloomComposer.render();
		scene.traverse(restoreMaterials);

		// Render final composite
		finalComposer.render();
	}, { autoInvalidate: false });

	return {
		bloomComposer,
		finalComposer,
		bloomPass,
		setIntensity: (val: number) => {
			bloomPass.strength = val;
			compositePass.uniforms.bloomStrength.value = val;
		},
		setEnabled: (val: boolean) => { enabled = val; },
		setThreshold: (val: number) => { bloomPass.threshold = val; },
		setRadius: (val: number) => { bloomPass.radius = val; }
	};
}
