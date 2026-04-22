import type { Effect } from '$lib/scene/types';
import HazeEffect from './HazeEffect.svelte';

const atmosphericHaze: Effect = {
	id: 'atmospheric-haze',
	kind: 'atmo',
	z: 0,
	component: HazeEffect,
};

export default atmosphericHaze;
