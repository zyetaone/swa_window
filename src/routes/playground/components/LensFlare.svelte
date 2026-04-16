<script lang="ts">
	/**
	 * LensFlare — optical sun flare triggered by camera-sun alignment.
	 *
	 * When the camera pan naturally aligns with the sun azimuth, a
	 * screen-blended flare (core + ring + streak) fades in. The intensity
	 * is `sunAlignment * (skyState === 'day' ? 0.85 : 0.6)`.
	 */

	interface Props {
		sunAlignment: number;
		skyState: string;
	}

	let { sunAlignment, skyState }: Props = $props();

	const opacity = $derived(sunAlignment * (skyState === 'day' ? 0.85 : 0.6));
</script>

{#if sunAlignment > 0.01}
	<div class="lens-flare" style="opacity: {opacity}">
		<div class="flare-core"></div>
		<div class="flare-ring"></div>
		<div class="flare-streak"></div>
	</div>
{/if}

<style>
	.lens-flare {
		position: absolute;
		inset: 0;
		pointer-events: none;
		display: flex;
		align-items: center;
		justify-content: center;
		mix-blend-mode: screen;
		transition: opacity 0.2s ease-out;
		z-index: 10;
	}
	.flare-core {
		position: absolute;
		width: 15vw;
		height: 15vw;
		border-radius: 50%;
		background: radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(255,230,180,0.5) 20%, rgba(255,180,100,0) 60%);
		filter: blur(10px);
	}
	.flare-ring {
		position: absolute;
		width: 45vw;
		height: 45vw;
		border-radius: 50%;
		border: 1px solid rgba(255, 180, 100, 0.15);
		background: radial-gradient(circle, rgba(255,180,100,0.05) 0%, rgba(255,180,100,0) 70%);
	}
	.flare-streak {
		position: absolute;
		width: 120vw;
		height: 4px;
		background: linear-gradient(90deg, rgba(255,200,100,0) 0%, rgba(255,220,150,0.6) 50%, rgba(255,200,100,0) 100%);
		filter: blur(2px);
		transform: rotate(5deg);
	}
</style>
