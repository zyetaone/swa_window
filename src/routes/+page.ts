/**
 * Page config - disable SSR for WebGL components
 *
 * This app uses Cesium which requires browser APIs.
 * SSR must be disabled to prevent "ReferenceError: window is not defined" errors.
 */
export const ssr = false;
export const prerender = true;
