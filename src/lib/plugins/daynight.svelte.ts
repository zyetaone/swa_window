/**
 * Day/Night Plugin - Auto-adjusts materials based on skyState
 *
 * Usage:
 * <script>
 *   import { daynight } from '$lib/plugins/daynight'
 *   daynight()
 * </script>
 *
 * <T.Mesh daynight={{ emissiveNight: 0xff8800, emissiveIntensity: 2 }}>
 *   <T.MeshStandardMaterial />
 * </T.Mesh>
 */

import { injectPlugin } from '@threlte/core';
import { useAppState } from '$lib/core';
import type { Object3D, MeshStandardMaterial, Material } from 'three';

export interface DayNightProps {
	/** Emissive color at night (hex number or CSS color) */
	emissiveNight?: number | string;
	/** Emissive intensity at night (default: 1) */
	emissiveIntensity?: number;
	/** Fade duration in seconds (default: 2) */
	fadeDuration?: number;
	/** Brightness multiplier for day (default: 1) */
	dayBrightness?: number;
	/** Brightness multiplier for night (default: 0.3) */
	nightBrightness?: number;
}

declare module '@threlte/core' {
	interface ThrelteUserProps {
		daynight?: DayNightProps;
	}
}

export function daynight() {
	injectPlugin<{ daynight?: DayNightProps }>('daynight', ({ ref, props }) => {
		if (!props.daynight) return;

		const { model } = useAppState();

		$effect(() => {
			const obj = ref as Object3D;
			if (!obj || !props.daynight) return;

			const opts = props.daynight;

			// Calculate day/night factor (0 = full day, 1 = full night)
			let nightFactor = 0;
			switch (model.skyState) {
				case 'night': nightFactor = 1; break;
				case 'dusk': nightFactor = 0.7; break;
				case 'dawn': nightFactor = 0.3; break;
				case 'day': nightFactor = 0; break;
			}

			// Find and update materials
			const updateMaterial = (material: Material) => {
				if ('emissive' in material) {
					const mat = material as MeshStandardMaterial;

					// Set emissive color if night emissive specified
					if (opts.emissiveNight && nightFactor > 0) {
						const color = typeof opts.emissiveNight === 'number'
							? opts.emissiveNight
							: opts.emissiveNight;
						mat.emissive.set(color);
						mat.emissiveIntensity = (opts.emissiveIntensity ?? 1) * nightFactor;
					} else {
						mat.emissiveIntensity = 0;
					}

					// Adjust overall brightness
					const dayBright = opts.dayBrightness ?? 1;
					const nightBright = opts.nightBrightness ?? 0.3;
					const brightness = dayBright + (nightBright - dayBright) * nightFactor;

					// Apply to color if it's a standard material
					if (mat.color) {
						// Store original color on first run
						if (!(mat as any)._originalColor) {
							(mat as any)._originalColor = mat.color.clone();
						}
						mat.color.copy((mat as any)._originalColor).multiplyScalar(brightness);
					}
				}
			};

			// Apply to mesh materials
			if ('material' in obj) {
				const mesh = obj as { material: Material | Material[] };
				if (Array.isArray(mesh.material)) {
					mesh.material.forEach(updateMaterial);
				} else if (mesh.material) {
					updateMaterial(mesh.material);
				}
			}
		});

		return {
			pluginProps: ['daynight']
		};
	});
}
