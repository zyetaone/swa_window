// SSR is disabled app-wide — every route mounts WebGL (Cesium) or talks to
// local /api endpoints that only exist at runtime. Per-route +page.ts files
// that only repeat `ssr = false` are redundant; opt into prerender at the
// leaf where it makes sense.
export const ssr = false;
