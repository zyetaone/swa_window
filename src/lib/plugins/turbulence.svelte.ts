/**
 * Turbulence Plugin - Adds motion noise to T components
 *
 * Usage:
 * <script>
 *   import { turbulence } from '$lib/plugins/turbulence'
 *   turbulence()
 * </script>
 *
 * <T.Mesh turbulence={{ intensity: 0.5, speed: 1 }}>
 *   ...
 * </T.Mesh>
 */

import { injectPlugin } from '@threlte/core';
import { useAppState } from '$lib/core';
import type { Object3D } from 'three';

export interface TurbulenceProps {
	/** Motion intensity multiplier (default: 1) */
	intensity?: number;
	/** Animation speed multiplier (default: 1) */
	speed?: number;
	/** Enable position wobble (default: true) */
	position?: boolean;
	/** Enable rotation wobble (default: false) */
	rotation?: boolean;
}

declare module '@threlte/core' {
	interface ThrelteUserProps {
		turbulence?: TurbulenceProps;
	}
}

export function turbulence() {
	injectPlugin<{ turbulence?: TurbulenceProps }>('turbulence', ({ ref, props }) => {
		// Skip if no turbulence prop
		if (!props.turbulence) return;

		const { model } = useAppState();

		// Store original position/rotation
		let originalPosition = { x: 0, y: 0, z: 0 };
		let originalRotation = { x: 0, y: 0, z: 0 };
		let initialized = false;

		$effect(() => {
			const obj = ref as Object3D;
			if (!obj || !props.turbulence) return;

			// Capture original values once
			if (!initialized) {
				originalPosition = { x: obj.position.x, y: obj.position.y, z: obj.position.z };
				originalRotation = { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z };
				initialized = true;
			}

			const opts = props.turbulence;
			const intensity = opts.intensity ?? 1;
			const speed = opts.speed ?? 1;

			// Get turbulence level from model
			const turbMult = model.turbulenceLevel === 'severe' ? 3 :
			                 model.turbulenceLevel === 'moderate' ? 1.5 : 1;

			// Calculate noise offsets based on time
			const t = model.time ?? 0;
			const noiseX = (Math.sin(t * 0.7 * speed) * 0.1 + Math.sin(t * 1.3 * speed) * 0.05) * intensity * turbMult;
			const noiseY = (Math.sin(t * 0.5 * speed) * 0.08 + Math.sin(t * 1.1 * speed) * 0.04) * intensity * turbMult;
			const noiseZ = (Math.sin(t * 0.9 * speed) * 0.06 + Math.sin(t * 1.7 * speed) * 0.03) * intensity * turbMult;

			// Apply position wobble
			if (opts.position !== false) {
				obj.position.x = originalPosition.x + noiseX * 0.1;
				obj.position.y = originalPosition.y + noiseY * 0.05;
				obj.position.z = originalPosition.z + noiseZ * 0.1;
			}

			// Apply rotation wobble
			if (opts.rotation) {
				obj.rotation.x = originalRotation.x + Math.sin(t * 0.3 * speed) * 0.005 * intensity * turbMult;
				obj.rotation.y = originalRotation.y + Math.sin(t * 0.2 * speed) * 0.003 * intensity * turbMult;
				obj.rotation.z = originalRotation.z + Math.sin(t * 0.4 * speed) * 0.008 * intensity * turbMult;
			}
		});

		return {
			pluginProps: ['turbulence']
		};
	});
}
