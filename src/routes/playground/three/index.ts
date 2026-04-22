/**
 * Public API for the playground's Three.js post-process stack.
 *
 * Day-1 surface: PostProcessMount + the composer controller.
 * Day-2+ will add WaterPass and whatever else — export those from here.
 */

export { default as PostProcessMount } from './PostProcessMount.svelte';
export { createPostComposer, dawnDuskFrom, type PostComposerHandle } from './post-composer.svelte';
export { createColorGradePass, updateColorGradeUniforms, type ColorGradeUniforms } from './passes/ColorGradePass';
export { createWaterPass, type WaterPassHandle, type WaterUniforms } from './passes/WaterPass';
