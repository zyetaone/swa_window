/**
 * The whole app is the kiosk, and the kiosk is WebGL: nothing here can render
 * on a server. `maplibre-gl` also touches browser globals at import time, so
 * this is a hard requirement rather than a preference.
 *
 * Cascades to every route below, `/` included.
 */
export const ssr = false;
