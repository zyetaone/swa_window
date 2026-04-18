import type { Band } from './sun-palette.svelte';

// Module-level water animation clock — plain RAF, not $effect (which
// requires component context and can't run at module scope).
export const waterState = $state({ time: 0 });

export const getWaterTime = () => waterState.time;

if (typeof window !== 'undefined') {
	let last = performance.now();
	const loop = (now: number) => {
		const dt = Math.min((now - last) / 1000, 0.1);
		last = now;
		waterState.time += dt;
		requestAnimationFrame(loop);
	};
	requestAnimationFrame(loop);
}

export function getWaterColor(waterTime: number, skyPalette: Band): string {
	const shimmer = Math.sin(waterTime * 0.6) * 0.5 + 0.5;
	const w = skyPalette.water;
	const r = Math.round(w.r + shimmer * 10);
	const g = Math.round(w.g + shimmer * 10);
	const b = Math.round(w.b + shimmer * 12);
	return `rgba(${r}, ${g}, ${b}, 1)`;
}

export function getWaterOpacity(waterTime: number): number {
	return 0.35 + Math.sin(waterTime * 0.4) * 0.06;
}

export function getShoreColor(waterTime: number, nightFactor: number): string {
	const wave = Math.sin(waterTime * 1.2) * 0.5 + 0.5;
	if (nightFactor > 0.5) {
		const b = Math.round(80 + wave * 40);
		return `rgba(${60 + Math.round(wave * 20)}, ${70 + Math.round(wave * 25)}, ${b}, 0.7)`;
	}
	const r = Math.round(180 + wave * 75);
	const g = Math.round(210 + wave * 45);
	const b = Math.round(220 + wave * 35);
	return `rgba(${r}, ${g}, ${b}, 0.6)`;
}

export function getNightWaterColor(waterTime: number): string {
	const pulse = Math.sin(waterTime * 0.5) * 0.5 + 0.5;
	const a = Math.round(55 + pulse * 40);
	return `rgba(255, 190, 100, ${(a / 255).toFixed(3)})`;
}

export function getNightWaterOpacity(nightFactor: number, waterTime: number): number {
	return nightFactor * 0.45 + Math.sin(waterTime * 0.5) * 0.06;
}

export function hexToRgba(hex: string, alpha: number): string {
	const r = parseInt(hex.slice(1, 3), 16) || 255;
	const g = parseInt(hex.slice(3, 5), 16) || 255;
	const b = parseInt(hex.slice(5, 7), 16) || 255;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
