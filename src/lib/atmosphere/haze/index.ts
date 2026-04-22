import type { Effect } from '$lib/scene/types';
import { Z } from '$lib/scene/layers';
import HazeEffect from './HazeEffect.svelte';

const atmosphericHaze: Effect = {
	id: 'atmospheric-haze',
	kind: 'atmo',
	z: Z.haze,
	component: HazeEffect,
};

export default atmosphericHaze;
