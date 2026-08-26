/**
 * ambient-audio.ts — Pure Web Audio API Synthesized Jet Cabin Ambience.
 *
 * Generates continuous, seamless low-frequency turbofan cabin rumble and airflow
 * without any audio files, licensing, or network transfer overhead.
 */

export function clamp01(n: number): number {
	return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

export function engineCutoffHz(altitudeM: number): number {
	if (!Number.isFinite(altitudeM)) return 220;
	const t = Math.min(1, Math.max(0, altitudeM / 12_000));
	return 220 - t * 110;
}

export class AmbientAudioEngine {
	private ctx: AudioContext | null = null;
	private masterGain: GainNode | null = null;
	private engineFilter: BiquadFilterNode | null = null;
	private noiseNode: AudioBufferSourceNode | null = null;

	init(): void {
		if (typeof window === 'undefined' || this.ctx) return;
		try {
			const AudioCtx =
				window.AudioContext ||
				(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
			this.ctx = new AudioCtx();

			this.masterGain = this.ctx.createGain();
			this.masterGain.gain.value = 0;
			this.masterGain.connect(this.ctx.destination);

			// Biquad lowpass filter for cabin rumble
			this.engineFilter = this.ctx.createBiquadFilter();
			this.engineFilter.type = 'lowpass';
			this.engineFilter.frequency.value = 180;
			this.engineFilter.Q.value = 2.5;
			this.engineFilter.connect(this.masterGain);

			// 2-second looped white noise buffer
			const sampleRate = this.ctx.sampleRate;
			const bufferSize = sampleRate * 2;
			const buffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
			const data = buffer.getChannelData(0);
			for (let i = 0; i < bufferSize; i++) {
				data[i] = Math.random() * 2 - 1;
			}

			this.noiseNode = this.ctx.createBufferSource();
			this.noiseNode.buffer = buffer;
			this.noiseNode.loop = true;
			this.noiseNode.connect(this.engineFilter);
			this.noiseNode.start();
		} catch (e) {
			console.warn('[AmbientAudio] Web Audio initialization deferred:', e);
		}
	}

	setVolume(vol: number, enabled: boolean): void {
		if (!this.ctx || !this.masterGain) return;
		if (this.ctx.state === 'suspended' && enabled) {
			this.ctx.resume().catch(() => {});
		}
		const target = enabled ? clamp01(vol) * 0.35 : 0;
		this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.2);
	}

	setAltitude(altitudeM: number): void {
		if (!this.ctx || !this.engineFilter) return;
		const targetHz = engineCutoffHz(altitudeM);
		this.engineFilter.frequency.setTargetAtTime(targetHz, this.ctx.currentTime, 0.5);
	}

	destroy(): void {
		if (this.ctx) {
			this.ctx.close().catch(() => {});
			this.ctx = null;
		}
	}
}
